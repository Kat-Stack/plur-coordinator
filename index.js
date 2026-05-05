require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { initDB } = require('./db.js');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers] });

client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
        const command = require(filePath);
        if ('data' in command && 'execute' in command) client.commands.set(command.data.name, command);
    } catch (err) { console.error(`🚨 FATAL ERROR: ${file}\n${err.message}`); }
}

async function executePassedProposal(proposal, channel, client) {
    if (proposal.proposal_type === 'global_broadcast') {
        const allGlobals = await client.db.all(`SELECT channel_id FROM globals`);
        let successCount = 0;
        for (const entry of allGlobals) {
            try {
                const targetChannel = await client.channels.fetch(entry.channel_id).catch(() => null);
                if (targetChannel) {
                    const globalEmbed = new EmbedBuilder()
                        .setTitle(proposal.payload)
                        .setAuthor({ 
                            name: `[${channel.name}, ${channel.guild ? channel.guild.name : 'Network'}]`, 
                            iconURL: channel.guild ? channel.guild.iconURL() : client.user.displayAvatarURL() 
                        })
                        .setDescription(`📡 Virtnet`)
                        .setColor('#2ecc71')
                        .setTimestamp();
                    
                    await targetChannel.send({ embeds: [globalEmbed] });
                    successCount++;
                }
            } catch (err) { }
        }
        await channel.send(`🌐 **Broadcast Executed.** Transmitted to ${successCount} nodes.`);
    
    } else if (proposal.proposal_type === 'collective_reply') {
        const [targetId, originalMsgId, ...textArray] = proposal.payload.split('|');
        const replyText = textArray.join('|');

        try {
            const targetChannel = await client.channels.fetch(targetId).catch(() => null);
            if (targetChannel) {
                const speechEmbed = new EmbedBuilder()
                    .setAuthor({ name: `[${channel.name}, ${channel.guild ? channel.guild.name : 'Network'}]`, iconURL: channel.guild ? channel.guild.iconURL() : client.user.displayAvatarURL() })
                    .setDescription(replyText)
                    .setColor('#9b59b6')
                    .setTimestamp();
                
                let hubMessage;
                try {
                    hubMessage = await targetChannel.send({ embeds: [speechEmbed], reply: { messageReference: originalMsgId } });
                } catch (e) {
                    hubMessage = await targetChannel.send({ embeds: [speechEmbed] }); 
                }

                const siblings = await client.db.all(`SELECT listening_plur_id FROM plur_connections WHERE target_plur_id = ? AND listening_plur_id != ?`, [targetId, channel.id]);
                for (const sib of siblings) {
                    const sibChan = await client.channels.fetch(sib.listening_plur_id).catch(()=>null);
                    if (sibChan) {
                        const siblingEmbed = new EmbedBuilder()
                            .setAuthor({ name: `${channel.name} (@ ${targetChannel.name})`, iconURL: channel.guild ? channel.guild.iconURL() : client.user.displayAvatarURL() })
                            .setDescription(replyText)
                            .setColor('#2c3e50') 
                            .setFooter({ text: `Source ID: ${hubMessage.id} | From #${targetChannel.name}` });
                        
                        const replyBtn = new ButtonBuilder().setCustomId(`initiate_reply_${hubMessage.id}_${targetId}`).setLabel('Propose Reply').setStyle(ButtonStyle.Primary);
                        await sibChan.send({ embeds: [siblingEmbed], components: [new ActionRowBuilder().addComponents(replyBtn)] });
                    }
                }
                await channel.send(`🗣️ **Collective Reply Transmitted:**\n> ${replyText}`);
            }
        } catch (err) { console.error(err); await channel.send(`⛔ **Transmission Failed.**`); }

    } else if (proposal.proposal_type === 'collective_speech') {
        if (channel.isThread()) {
            const link = await client.db.get(`SELECT parent_thread_id FROM thread_links WHERE shadow_thread_id = ?`, [channel.id]);
            if (link) {
                try {
                    const parentThread = await client.channels.fetch(link.parent_thread_id).catch(() => null);
                    if (parentThread) {
                        const speechEmbed = new EmbedBuilder()
                            .setAuthor({ name: `[Collective Citizen: ${channel.name}]`, iconURL: channel.guild ? channel.guild.iconURL() : client.user.displayAvatarURL() })
                            .setDescription(proposal.payload)
                            .setColor('#9b59b6')
                            .setTimestamp();
                        
                        await parentThread.send({ embeds: [speechEmbed] });
                        await channel.send(`🗣️ **Thread Reply Transmitted:**\n> ${proposal.payload}`);
                        return; 
                    }
                } catch (e) { console.error(e); }
            }
            await channel.send(`⛔ **Transmission Failed.** This thread is not linked to a parent Hub's thread.`);
        
        } else {
            const listeners = await client.db.all(`SELECT listening_plur_id FROM plur_connections WHERE target_plur_id = ?`, [channel.id]);
            if (listeners && listeners.length > 0) {
                let successCount = 0;
                for (const listener of listeners) {
                    const childChannel = await client.channels.fetch(listener.listening_plur_id).catch(() => null);
                    if (childChannel) {
                        const followerEmbed = new EmbedBuilder()
                            .setAuthor({ name: `[Official Broadcast: ${channel.name}]`, iconURL: channel.guild ? channel.guild.iconURL() : client.user.displayAvatarURL() })
                            .setDescription(proposal.payload)
                            .setColor('#3498db') 
                            .setFooter({ text: 'Targeted Follower Transmission' })
                            .setTimestamp();
                        
                        await childChannel.send({ embeds: [followerEmbed] });
                        successCount++;
                    }
                }
                await channel.send(`🗣️ **Follower Broadcast Transmitted** to ${successCount} node(s):\n> ${proposal.payload}`);
            } else {
                await channel.send(`⛔ **Transmission Failed.** This node currently has no followers.`);
            }
        }

    } else if (proposal.proposal_type === 'join_plur') {
        const targetId = proposal.payload.replace(/\D/g, ''); 
        try {
            const targetChannel = await client.channels.fetch(targetId).catch(() => null);
            if (!targetChannel) return channel.send(`⛔ **Bridge Error:** Cannot locate target channel.`);

            const targetSettings = await client.db.get(`SELECT is_closed FROM plur_settings WHERE channel_id = ?`, [targetId]);

            if (targetSettings && targetSettings.is_closed === 1) {
                const targetVoters = await client.db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [targetId]);
                if (targetVoters.length === 0) return channel.send(`⛔ **Application Failed:** Target node has no active citizens to review the request.`);

                const REQUIRED_VOTES = Math.floor(targetVoters.length / 2) + 1;
                const newProposalId = `prop_app_${Date.now()}`;

                const appThread = await targetChannel.threads.create({
                    name: `🛂 Node Application: ${channel.name}`,
                    type: ChannelType.PublicThread,
                    autoArchiveDuration: 1440,
                    reason: 'Network Bridge Application.'
                });

                const appEmbed = new EmbedBuilder()
                    .setTitle(`🛂 Network Application`)
                    .setDescription(`**Applicant Node:** <#${channel.id}>\n\nOur borders are currently **CLOSED**. This node is requesting to establish a bridge and become a collective citizen.`)
                    .setColor('#e67e22')
                    .setFooter({ text: `Requires ${REQUIRED_VOTES} citizen votes to approve.` });

                const appApprove = new ButtonBuilder().setCustomId(`vote_yes_${newProposalId}`).setLabel(`Approve (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Success);
                const appReject = new ButtonBuilder().setCustomId(`vote_no_${newProposalId}`).setLabel(`Reject (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Danger);

                const voteMsg = await appThread.send({ embeds: [appEmbed], components: [new ActionRowBuilder().addComponents(appApprove, appReject)] });

                await client.db.run(`INSERT INTO active_proposals (proposal_id, channel_id, thread_id, message_id, author_id, proposal_type, payload, required_votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                    [newProposalId, targetId, appThread.id, voteMsg.id, 'SYSTEM_ROUTER', 'admit_citizen', channel.id, REQUIRED_VOTES]);

                const collectiveCitizens = await client.db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ? AND member_type = 'plur'`, [targetId]);
                for (const collective of collectiveCitizens) {
                    try {
                        const shadowChannel = await client.channels.fetch(collective.user_id).catch(() => null);
                        if (shadowChannel) {
                            const shadowVoters = await client.db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [collective.user_id]);
                            if (shadowVoters.length === 0) continue; 
                            
                            const SHADOW_REQ = Math.floor(shadowVoters.length / 2) + 1;
                            const shadowPropId = `prop_shadow_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

                            const shadowThread = await shadowChannel.threads.create({
                                name: `🏛️ Proxy Vote: Node Application`,
                                type: ChannelType.PublicThread,
                                autoArchiveDuration: 1440,
                                reason: 'Holonic Proxy deliberation for reply node application.'
                            });

                            const shadowEmbed = new EmbedBuilder()
                                .setTitle(`🏛️ Holonic Proxy Vote Required`)
                                .setDescription(`**Target Hub:** <#${targetId}>\n**Action:** \`admit_citizen\`\n\n**Applicant Node:** <#${channel.id}>\n\n*Our collective must vote to cast our proxy vote on admitting this new network.*`)
                                .setColor('#9b59b6')
                                .setFooter({ text: `Requires ${SHADOW_REQ} local votes to lock in.` }); 

                            const shadowApprove = new ButtonBuilder().setCustomId(`vote_yes_${shadowPropId}`).setLabel(`Vote YES (0/${SHADOW_REQ})`).setStyle(ButtonStyle.Success);
                            const shadowReject = new ButtonBuilder().setCustomId(`vote_no_${shadowPropId}`).setLabel(`Vote NO (0/${SHADOW_REQ})`).setStyle(ButtonStyle.Danger);

                            const shadowVoteMsg = await shadowThread.send({ embeds: [shadowEmbed], components: [new ActionRowBuilder().addComponents(shadowApprove, shadowReject)] });
                            
                            await client.db.run(`INSERT INTO active_proposals (proposal_id, channel_id, thread_id, message_id, author_id, proposal_type, payload, required_votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                                [shadowPropId, collective.user_id, shadowThread.id, shadowVoteMsg.id, 'HOLONIC_SYSTEM', 'holonic_proxy', newProposalId, SHADOW_REQ]);

                            await client.db.run(`INSERT OR IGNORE INTO thread_links (parent_thread_id, shadow_thread_id) VALUES (?, ?)`, [appThread.id, shadowThread.id]);
                        }
                    } catch (err) { }
                }

                await channel.send(`🚪 **Application Submitted.** Target network has closed borders. Our request has been routed to their citizens for review.`);
            } else {
                await client.db.run(`INSERT OR IGNORE INTO plur_connections (target_plur_id, listening_plur_id) VALUES (?, ?)`, [targetId, channel.id]);
                await client.db.run(`INSERT OR IGNORE INTO plur_members (plur_channel_id, user_id, member_type) VALUES (?, ?, ?)`, [targetId, channel.id, 'plur']);
                await channel.send(`🔗 **Holonic Bridge Established.** We are now formally a collective citizen of **${targetChannel.name}**.`);
            }
        } catch (err) { await channel.send(`⛔ **Bridge Error.** Database routing failed.`); }

    } else if (proposal.proposal_type === 'toggle_borders') {
        const setting = await client.db.get(`SELECT is_closed FROM plur_settings WHERE channel_id = ?`, [channel.id]);
        const newStatus = setting && setting.is_closed ? 0 : 1;
        await client.db.run(`INSERT INTO plur_settings (channel_id, is_closed) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET is_closed = ?`, [channel.id, newStatus, newStatus]);
        await channel.send(`🛡️ **Border Policy Updated.** The node is now **${newStatus ? 'CLOSED' : 'OPEN'}**.`);
    
    } else if (proposal.proposal_type === 'admit_citizen') {
        const targetId = proposal.payload.replace(/\D/g, ''); 
        if (targetId) {
            const isNode = await client.channels.fetch(targetId).catch(() => null);
            if (isNode) {
                await client.db.run(`INSERT OR IGNORE INTO plur_members (plur_channel_id, user_id, member_type) VALUES (?, ?, ?)`, [channel.id, targetId, 'plur']);
                await client.db.run(`INSERT OR IGNORE INTO plur_connections (target_plur_id, listening_plur_id) VALUES (?, ?)`, [channel.id, targetId]);
                await channel.send(`🛂 **Network Admitted.** <#${targetId}> is now a collective citizen.`);
                try { await isNode.send(`✅ **Application Approved.** We have been admitted as a collective citizen of **${channel.name}**.`); } catch (e) {}
            } else {
                await client.db.run(`INSERT OR IGNORE INTO plur_members (plur_channel_id, user_id, member_type) VALUES (?, ?, ?)`, [channel.id, targetId, 'human']);
                await channel.send(`🛂 **Citizen Admitted.** <@${targetId}> has been granted voting rights.`);
                try {
                    const human = await client.users.fetch(targetId).catch(()=>null);
                    if (human) await human.send(`✅ **Application Approved.** You are now a voting citizen of **${channel.name}**.`);
                } catch (e) {}
            }
        }
    } else if (proposal.proposal_type === 'local_action') {
        const directiveEmbed = new EmbedBuilder().setTitle('📜 Official Node Directive').setDescription(proposal.payload).setColor('#f1c40f').setFooter({ text: 'Ratified by Local Consensus' }).setTimestamp();
        const pinnedMsg = await channel.send({ embeds: [directiveEmbed] });
        await pinnedMsg.pin();
        await channel.send(`🛠️ **Local Action Executed.** Directive pinned.`);
    }
}

client.once('clientReady', async (c) => { 
    try {
        console.log(`-----------------------------------------`);
        console.log(`NETWORK ONLINE: ${c.user.tag}`);
        client.db = await initDB(); 

        // THE SAFE BOOT SEQUENCE
        await client.db.exec(`
            CREATE TABLE IF NOT EXISTS active_proposals (
                proposal_id TEXT PRIMARY KEY, channel_id TEXT, thread_id TEXT, message_id TEXT, author_id TEXT, proposal_type TEXT, payload TEXT, required_votes INTEGER
            );
            CREATE TABLE IF NOT EXISTS locked_votes (
                proposal_id TEXT, user_id TEXT, vote TEXT, PRIMARY KEY (proposal_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS plur_members (
                plur_channel_id TEXT, user_id TEXT, member_type TEXT DEFAULT 'human', PRIMARY KEY (plur_channel_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS plur_connections (
                target_plur_id TEXT, listening_plur_id TEXT, PRIMARY KEY (target_plur_id, listening_plur_id)
            );
            CREATE TABLE IF NOT EXISTS plur_settings (
                channel_id TEXT PRIMARY KEY, is_closed INTEGER DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS thread_links (
                parent_thread_id TEXT, shadow_thread_id TEXT, PRIMARY KEY (parent_thread_id, shadow_thread_id)
            );
            CREATE TABLE IF NOT EXISTS globals (
                guild_id TEXT PRIMARY KEY, channel_id TEXT
            );
        `);
        console.log(`DATABASE: Memory systems fully operational and persistent!`);
        console.log(`-----------------------------------------`);
    } catch (err) { console.error("Critical failure during boot:", err); }
});

client.on('interactionCreate', async interaction => {
    if (interaction.isButton() && interaction.customId.startsWith('initiate_reply_')) {
        const [,, msgId, targetId] = interaction.customId.split('_');
        const isCitizen = await client.db.get(`SELECT * FROM plur_members WHERE plur_channel_id = ? AND user_id = ?`, [interaction.channelId, interaction.user.id]);
        if (!isCitizen) return interaction.reply({ content: '🚫 You must be a citizen to propose a reply.', flags: MessageFlags.Ephemeral });

        const modal = new ModalBuilder()
            .setCustomId(`modal_reply_${msgId}_${targetId}`)
            .setTitle('Propose Collective Reply');
        
        const responseInput = new TextInputBuilder()
            .setCustomId('reply_text')
            .setLabel("What should our collective say?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(responseInput));
        return await interaction.showModal(modal);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_reply_')) {
        const [,, msgId, targetId] = interaction.customId.split('_');
        const replyText = interaction.fields.getTextInputValue('reply_text');
        const bouncerChannelId = interaction.channelId;

        const registeredVoters = await client.db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [bouncerChannelId]);
        const REQUIRED_VOTES = Math.floor(registeredVoters.length / 2) + 1;
        const proposalId = `prop_${Date.now()}`;
        const compoundPayload = `${targetId}|${msgId}|${replyText}`;

        await interaction.reply({ content: `✅ Reply proposal logged. Generating thread...`, flags: MessageFlags.Ephemeral });

        const thread = await interaction.channel.threads.create({
            name: `Vote: 🗣️ Collective Reply`,
            type: ChannelType.PublicThread,
            autoArchiveDuration: 1440,
            reason: 'Deliberation for replying to Hub.'
        });

        const embed = new EmbedBuilder()
            .setTitle(`🏛️ Node Consensus Required`)
            .setDescription(`**Author:** <@${interaction.user.id}>\n**Action:** \`collective_reply\`\n\n**Proposed Reply:**\n${replyText}`)
            .setColor('#3498db')
            .setFooter({ text: `Requires ${REQUIRED_VOTES} citizen votes to execute.` }); 

        const approveButton = new ButtonBuilder().setCustomId(`vote_yes_${proposalId}`).setLabel(`Approve (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Success);
        const rejectButton = new ButtonBuilder().setCustomId(`vote_no_${proposalId}`).setLabel(`Reject (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Danger);

        const voteMsg = await thread.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(approveButton, rejectButton)] });
        
        await client.db.run(`INSERT INTO active_proposals (proposal_id, channel_id, thread_id, message_id, author_id, proposal_type, payload, required_votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
            [proposalId, bouncerChannelId, thread.id, voteMsg.id, interaction.user.id, 'collective_reply', compoundPayload, REQUIRED_VOTES]);
        return;
    }

    if (interaction.isButton() && (interaction.customId.startsWith('vote_yes_') || interaction.customId.startsWith('vote_no_'))) {
        const isYesVote = interaction.customId.startsWith('vote_yes_');
        const proposalId = interaction.customId.replace(isYesVote ? 'vote_yes_' : 'vote_no_', '');
        
        const proposal = await client.db.get(`SELECT * FROM active_proposals WHERE proposal_id = ?`, [proposalId]);
        if (!proposal) return interaction.reply({ content: '⚠️ This proposal has already been closed.', flags: MessageFlags.Ephemeral });

        const bouncerChannelId = interaction.channel.isThread() ? interaction.channel.parentId : interaction.channelId;
        const isCitizen = await client.db.get(`SELECT * FROM plur_members WHERE plur_channel_id = ? AND user_id = ?`, [bouncerChannelId, interaction.user.id]);
        if (!isCitizen) return interaction.reply({ content: '🚫 You are not a registered citizen of this plur.', flags: MessageFlags.Ephemeral });

        const hasVoted = await client.db.get(`SELECT * FROM locked_votes WHERE proposal_id = ? AND user_id = ?`, [proposalId, interaction.user.id]);
        if (hasVoted) return interaction.reply({ content: '🔒 Your vote is already locked in.', flags: MessageFlags.Ephemeral });

        await interaction.deferUpdate();
        await client.db.run(`INSERT INTO locked_votes (proposal_id, user_id, vote) VALUES (?, ?, ?)`, [proposalId, interaction.user.id, isYesVote ? 'yes' : 'no']);

        const yesData = await client.db.get(`SELECT COUNT(*) as count FROM locked_votes WHERE proposal_id = ? AND vote = 'yes'`, [proposalId]);
        const noData = await client.db.get(`SELECT COUNT(*) as count FROM locked_votes WHERE proposal_id = ? AND vote = 'no'`, [proposalId]);

        if (yesData.count >= proposal.required_votes || noData.count >= proposal.required_votes) {
            await client.db.run(`DELETE FROM active_proposals WHERE proposal_id = ?`, [proposalId]);
            const passed = yesData.count >= proposal.required_votes;
            
            const embed = EmbedBuilder.from(interaction.message.embeds[0]).setTitle(passed ? '✅ CONSENSUS REACHED' : '❌ PROPOSAL REJECTED').setColor(passed ? '#2ecc71' : '#e74c3c');
            await interaction.message.edit({ embeds: [embed], components: [] });

            if (proposal.proposal_type === 'holonic_proxy') {
                const parentProposalId = proposal.payload;
                const collectiveVote = passed ? 'yes' : 'no';
                
                console.log(`\n[HOLONIC SYNC] Plur [${bouncerChannelId}] resolved shadow thread. Proxy vote: ${collectiveVote.toUpperCase()}`);
                
                const parentProposal = await client.db.get(`SELECT * FROM active_proposals WHERE proposal_id = ?`, [parentProposalId]);
                
                if (parentProposal) {
                    const hasProxyVoted = await client.db.get(`SELECT * FROM locked_votes WHERE proposal_id = ? AND user_id = ?`, [parentProposalId, bouncerChannelId]);
                    if (!hasProxyVoted) {
                        await client.db.run(`INSERT INTO locked_votes (proposal_id, user_id, vote) VALUES (?, ?, ?)`, [parentProposalId, bouncerChannelId, collectiveVote]);
                        await interaction.channel.send(`🌌 **Plur Vote:** We voted **${collectiveVote.toUpperCase()}**`);
                        
                        const pYes = await client.db.get(`SELECT COUNT(*) as count FROM locked_votes WHERE proposal_id = ? AND vote = 'yes'`, [parentProposalId]);
                        const pNo = await client.db.get(`SELECT COUNT(*) as count FROM locked_votes WHERE proposal_id = ? AND vote = 'no'`, [parentProposalId]);
                        
                        console.log(`[HOLONIC SYNC] Parent Math -> Yes: ${pYes.count}, No: ${pNo.count}, Required: ${parentProposal.required_votes}`);

                        const pThread = await client.channels.fetch(parentProposal.thread_id).catch(err => console.error(`[SYNC ERROR] Could not fetch parent thread:`, err));
                        let pMsg = null;
                        if (pThread) pMsg = await pThread.messages.fetch(parentProposal.message_id).catch(err => console.error(`[SYNC ERROR] Could not fetch parent message:`, err));

                        if (pYes.count >= parentProposal.required_votes || pNo.count >= parentProposal.required_votes) {
                            console.log(`[HOLONIC SYNC] Proxy vote tipped the scale! Executing parent action...`);
                            await client.db.run(`DELETE FROM active_proposals WHERE proposal_id = ?`, [parentProposalId]);
                            const parentPassed = pYes.count >= parentProposal.required_votes;
                            
                            if (pMsg) {
                                const updatedEmbed = EmbedBuilder.from(pMsg.embeds[0]).setTitle(parentPassed ? '✅ CONSENSUS REACHED' : '❌ PROPOSAL REJECTED').setColor(parentPassed ? '#2ecc71' : '#e74c3c');
                                await pMsg.edit({ embeds: [updatedEmbed], components: [] });
                                await pThread.send(parentPassed ? `✅ **Consensus Reached** (Triggered by proxy vote).` : `❌ **Proposal Rejected** (Triggered by proxy vote).`);
                                setTimeout(async () => { await pThread.setLocked(true, 'Consensus reached.'); await pThread.setArchived(true, 'Consensus reached.'); }, 3000); 
                            }

                            if (parentPassed) {
                                const execChannel = await client.channels.fetch(parentProposal.channel_id).catch(() => null);
                                if (execChannel) await executePassedProposal(parentProposal, execChannel, client);
                            }
                        } else {
                            console.log(`[HOLONIC SYNC] Parent vote ongoing. Updating UI buttons.`);
                            if (pMsg) {
                                const approveBtn = new ButtonBuilder().setCustomId(`vote_yes_${parentProposalId}`).setLabel(`Approve (${pYes.count}/${parentProposal.required_votes})`).setStyle(ButtonStyle.Success);
                                const rejectBtn = new ButtonBuilder().setCustomId(`vote_no_${parentProposalId}`).setLabel(`Reject (${pNo.count}/${parentProposal.required_votes})`).setStyle(ButtonStyle.Danger);
                                await pMsg.edit({ components: [new ActionRowBuilder().addComponents(approveBtn, rejectBtn)] });
                            }
                        }
                    } else { await interaction.channel.send(`⚠️ **Holonic Sync:** We already cast our vote.`); }
                } else { await interaction.channel.send(`⚠️ **Holonic Sync:** The reply node's vote concluded before we reached local consensus.`); }
            } else {
                if (passed) {
                    const execChannel = await client.channels.fetch(bouncerChannelId);
                    await executePassedProposal(proposal, execChannel, client);
                } else {
                    await interaction.channel.send(`⛔ **Action Vetoed.**`);
                }
            }

            if (interaction.channel.isThread()) {
                setTimeout(async () => {
                    await interaction.channel.setLocked(true, 'Consensus reached.');
                    await interaction.channel.setArchived(true, 'Consensus reached.');
                }, 3000); 
            }
        } else {
            const approveBtn = new ButtonBuilder().setCustomId(`vote_yes_${proposalId}`).setLabel(`Approve (${yesData.count}/${proposal.required_votes})`).setStyle(ButtonStyle.Success);
            const rejectBtn = new ButtonBuilder().setCustomId(`vote_no_${proposalId}`).setLabel(`Reject (${noData.count}/${proposal.required_votes})`).setStyle(ButtonStyle.Danger);
            await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(approveBtn, rejectBtn)] });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try { await command.execute(interaction, client.db); } catch (error) { console.error(error); }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return; 
    if (message.channel.isThread()) return; 

    const listeners = await client.db.all(`SELECT listening_plur_id FROM plur_connections WHERE target_plur_id = ?`, [message.channel.id]);
    
    if (listeners && listeners.length > 0) {
        console.log(`\n[ROUTER] Intercepted message in Hub [${message.channel.id}]. Fanning out to ${listeners.length} children...`);
        for (const listener of listeners) {
            try {
                const listeningChannel = await client.channels.fetch(listener.listening_plur_id).catch(() => null);
                
                if (listeningChannel) {
                    const mirrorEmbed = new EmbedBuilder()
                        .setAuthor({ name: `${message.author.username} (@ ${message.guild.name})`, iconURL: message.author.displayAvatarURL() })
                        .setDescription(message.content || "*[Media]*")
                        .setColor('#2c3e50')
                        .setFooter({ text: `Source ID: ${message.id} | From #${message.channel.name}` });

                    const replyButton = new ButtonBuilder()
                        .setCustomId(`initiate_reply_${message.id}_${message.channel.id}`)
                        .setLabel('Propose Reply')
                        .setStyle(ButtonStyle.Primary);

                    await listeningChannel.send({ 
                        embeds: [mirrorEmbed], 
                        components: [new ActionRowBuilder().addComponents(replyButton)] 
                    });
                }
            } catch (err) { console.error(`[ROUTER ERROR] Failed to send to child:`, err); }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);