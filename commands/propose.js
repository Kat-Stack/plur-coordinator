const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('propose')
        .setDescription('Open a node consensus thread for a new proposal.')
        .addStringOption(option => 
            option.setName('type')
                .setDescription('What kind of action is this?')
                .setRequired(true)
                .addChoices(
                    { name: 'Global Broadcast', value: 'global_broadcast' },
                    { name: 'Send to plur we are in /(use this in a thread)', value: 'collective_speech' },
					{ name: 'Join Plur', value: 'join_plur' },
                    { name: 'Toggle Walls and Privacy (Open/Close)', value: 'toggle_borders' },
					{ name: 'Local Action (Pin)', value: 'local_action' },
                    { name: 'Admit Citizen (Sponsor - currently broken)', value: 'admit_citizen' }
                )
        )
        .addStringOption(option => 
            option.setName('payload')
                .setDescription('The message, target ID, @user, or parameter to vote on.')
                .setRequired(true)
        ),

    async execute(interaction, db) {
        const proposalType = interaction.options.getString('type');
        const payloadText = interaction.options.getString('payload');
        
        const bouncerChannelId = interaction.channel.isThread() ? interaction.channel.parentId : interaction.channelId;
        const isCitizen = await db.get(`SELECT * FROM plur_members WHERE plur_channel_id = ? AND user_id = ?`, [bouncerChannelId, interaction.user.id]);
        
        if (!isCitizen) return interaction.reply({ content: '⚠️ You must be an active citizen to initiate a proposal.', flags: MessageFlags.Ephemeral });

        const registeredVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ? AND member_type = 'human'`, [bouncerChannelId]);
        if (registeredVoters.length === 0) return interaction.reply({ content: '⚠️ Node has no human citizens.', flags: MessageFlags.Ephemeral });

        const allVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [bouncerChannelId]);
        const REQUIRED_VOTES = Math.floor(allVoters.length / 2) + 1;
        const proposalId = `prop_${Date.now()}`;

        await interaction.reply({ content: `✅ Proposal logged. Generating consensus thread...`, flags: MessageFlags.Ephemeral });

        let targetChannel = interaction.channel;
        if (!interaction.channel.isThread()) {
            let threadPrefix = '🛠️ Local Action';
            if (proposalType === 'global_broadcast') threadPrefix = '📡 Global Transmit';
            if (proposalType === 'join_plur') threadPrefix = '🔗 Join Plur';
            if (proposalType === 'toggle_borders') threadPrefix = '🛡️ Border Policy';
            if (proposalType === 'admit_citizen') threadPrefix = '🛂 Applications';
            if (proposalType === 'collective_speech') threadPrefix = '🗣️ Collective Speech';

            targetChannel = await interaction.channel.threads.create({
                name: `Vote: ${threadPrefix}`,
                type: ChannelType.PublicThread,
                autoArchiveDuration: 1440,
                reason: 'Dedicated node voting and deliberation thread.'
            });
        }

        let displayPayload = payloadText;
        if (proposalType === 'join_plur') {
            const cleanId = payloadText.replace(/\D/g, '');
            if (cleanId) {
                const fetchedChannel = await interaction.client.channels.fetch(cleanId).catch(() => null);
                if (fetchedChannel) {
                    displayPayload = `**${fetchedChannel.name}**\n*(ID: \`${cleanId}\`)*`;
                } else {
                    displayPayload = `⚠️ **Unknown Network**\n*(ID: \`${cleanId}\`)*\n*Warning: I cannot see this channel.*`;
                }
            }
        } else if (proposalType === 'admit_citizen') {
            const cleanId = payloadText.replace(/\D/g, '');
            if (cleanId) displayPayload = `<@${cleanId}>\n*(ID: \`${cleanId}\`)*`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏛️ Node Consensus Required`)
            .setDescription(`**Author:** <@${interaction.user.id}>\n**Action:** \`${proposalType}\`\n\n**Payload:**\n${displayPayload}`)
            .setColor('#3498db')
            .setFooter({ text: `Requires ${REQUIRED_VOTES} citizen votes to execute or reject.` }); 

        const approveButton = new ButtonBuilder().setCustomId(`vote_yes_${proposalId}`).setLabel(`Approve (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Success);
        const rejectButton = new ButtonBuilder().setCustomId(`vote_no_${proposalId}`).setLabel(`Reject (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Danger);

        const voteMsg = await targetChannel.send({ 
            content: `<@${interaction.user.id}> has initiated a vote. Discuss and lock in below.`, 
            embeds: [embed], components: [new ActionRowBuilder().addComponents(approveButton, rejectButton)] 
        });

        await db.run(`INSERT INTO active_proposals (proposal_id, channel_id, thread_id, message_id, author_id, proposal_type, payload, required_votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
            [proposalId, bouncerChannelId, targetChannel.id, voteMsg.id, interaction.user.id, proposalType, payloadText, REQUIRED_VOTES]);

        const collectiveCitizens = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ? AND member_type = 'plur'`, [bouncerChannelId]);
        
        for (const collective of collectiveCitizens) {
            try {
                const shadowChannelId = collective.user_id;
                const shadowChannel = await interaction.client.channels.fetch(shadowChannelId).catch(() => null);
                
                if (shadowChannel) {
                    const shadowVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [shadowChannelId]);
                    if (shadowVoters.length === 0) continue; 
                    
                    const SHADOW_REQ = Math.floor(shadowVoters.length / 2) + 1;
                    const shadowPropId = `prop_shadow_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

                    const shadowThread = await shadowChannel.threads.create({
                        name: `🏛️ Proxy Vote: ${proposalType}`,
                        type: ChannelType.PublicThread,
                        autoArchiveDuration: 1440,
                        reason: 'Holonic Proxy deliberation for reply node.'
                    });

                    const shadowEmbed = new EmbedBuilder()
                        .setTitle(`🏛️ Holonic Proxy Vote Required`)
                        .setDescription(`**Target Node:** <#${bouncerChannelId}>\n**Action:** \`${proposalType}\`\n\n**Payload:**\n${displayPayload}\n\n*Our collective is registered as a citizen of the target node. We must vote to cast our proxy vote.*`)
                        .setColor('#9b59b6')
                        .setFooter({ text: `Requires ${SHADOW_REQ} local votes to lock in our collective decision.` }); 

                    const shadowApprove = new ButtonBuilder().setCustomId(`vote_yes_${shadowPropId}`).setLabel(`Vote YES (0/${SHADOW_REQ})`).setStyle(ButtonStyle.Success);
                    const shadowReject = new ButtonBuilder().setCustomId(`vote_no_${shadowPropId}`).setLabel(`Vote NO (0/${SHADOW_REQ})`).setStyle(ButtonStyle.Danger);

                    const shadowVoteMsg = await shadowThread.send({ 
                        content: `**ATTENTION CITIZENS:** A reply node requires our proxy vote.`,
                        embeds: [shadowEmbed], components: [new ActionRowBuilder().addComponents(shadowApprove, shadowReject)] 
                    });

                    await db.run(`INSERT INTO active_proposals (proposal_id, channel_id, thread_id, message_id, author_id, proposal_type, payload, required_votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                        [shadowPropId, shadowChannelId, shadowThread.id, shadowVoteMsg.id, 'HOLONIC_SYSTEM', 'holonic_proxy', proposalId, SHADOW_REQ]);

                    await db.run(`INSERT OR IGNORE INTO thread_links (parent_thread_id, shadow_thread_id) VALUES (?, ?)`, [targetChannel.id, shadowThread.id]);
                }
            } catch (err) { console.error("Failed to generate shadow thread:", err); }
        }
    }
};