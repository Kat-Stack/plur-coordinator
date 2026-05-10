const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join_plur')
        .setDescription('Propose a vote to intercept and listen to another plur.')
        .addStringOption(option =>
            option.setName('target_id')
                .setDescription('The Internal Node ID (e.g., 1) or raw Channel ID')
                .setRequired(true)),

    async execute(interaction, db) {
        const bouncerChannelId = interaction.channel.isThread() ? interaction.channel.parentId : interaction.channelId;
        const rawInput = interaction.options.getString('target_id').trim();

        // --- THE ID RESOLVER ---
        let targetChannelId = rawInput;
        // If the input is just a short string of numbers, assume it's a Short ID and look it up
        if (/^\d{1,6}$/.test(rawInput)) {
            const registryEntry = await db.get(`SELECT channel_id FROM node_registry WHERE short_id = ?`, [rawInput]);
            if (registryEntry) {
                targetChannelId = registryEntry.channel_id;
            } else {
                return interaction.reply({ content: `❌ Cannot find a node in the mesh with Internal ID \`${rawInput}\`.`, flags: MessageFlags.Ephemeral });
            }
        }

        if (targetChannelId === bouncerChannelId) return interaction.reply({ content: "❌ You cannot bridge to your own cell.", flags: MessageFlags.Ephemeral });

        const isCitizen = await db.get(`SELECT * FROM plur_members WHERE plur_channel_id = ? AND user_id = ?`, [bouncerChannelId, interaction.user.id]);
        if (!isCitizen) return interaction.reply({ content: '⚠️ You must be an active citizen to initiate a bridge proposal.', flags: MessageFlags.Ephemeral });

        const registeredVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ? AND member_type = 'human'`, [bouncerChannelId]);
        if (registeredVoters.length === 0) return interaction.reply({ content: '⚠️ Node has no human citizens to vote.', flags: MessageFlags.Ephemeral });

        const allVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [bouncerChannelId]);
        const REQUIRED_VOTES = Math.floor(allVoters.length / 2) + 1;
        const proposalId = `prop_${Date.now()}`;

        await interaction.reply({ content: `✅ Bridge proposal logged. Generating consensus thread...`, flags: MessageFlags.Ephemeral });

        let targetChannel = interaction.channel;
        if (!interaction.channel.isThread()) {
            targetChannel = await interaction.channel.threads.create({
                name: `Vote: 🔗 Join Plur`,
                type: ChannelType.PublicThread,
                autoArchiveDuration: 1440,
                reason: 'Dedicated node voting for network bridge.'
            });
        }

        let displayPayload = targetChannelId;
        const fetchedChannel = await interaction.client.channels.fetch(targetChannelId).catch(() => null);
        if (fetchedChannel) {
            displayPayload = `**${fetchedChannel.name}**\n*(ID: \`${targetChannelId}\`)*`;
        } else {
            displayPayload = `⚠️ **Unknown Network**\n*(ID: \`${targetChannelId}\`)*\n*Warning: I cannot see this channel natively.*`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏛️ Node Consensus Required`)
            .setDescription(`**Author:** <@${interaction.user.id}>\n**Action:** \`join_plur\`\n\n**Target Network:**\n${displayPayload}`)
            .setColor('#3498db')
            .setFooter({ text: `Requires ${REQUIRED_VOTES} citizen votes to execute or reject.` });

        const approveButton = new ButtonBuilder().setCustomId(`vote_yes_${proposalId}`).setLabel(`Approve (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Success);
        const rejectButton = new ButtonBuilder().setCustomId(`vote_no_${proposalId}`).setLabel(`Reject (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Danger);

        const voteMsg = await targetChannel.send({
            content: `<@${interaction.user.id}> has initiated a vote. Discuss and lock in below.`,
            embeds: [embed], components: [new ActionRowBuilder().addComponents(approveButton, rejectButton)]
        });

        // Save the raw, resolved targetChannelId as the payload so index.js execution doesn't break
        await db.run(`INSERT INTO active_proposals (proposal_id, channel_id, thread_id, message_id, author_id, proposal_type, payload, required_votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [proposalId, bouncerChannelId, targetChannel.id, voteMsg.id, interaction.user.id, 'join_plur', targetChannelId, REQUIRED_VOTES]);

        // Holonic Proxy Sync
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
                        name: `🏛️ Proxy Vote: join_plur`,
                        type: ChannelType.PublicThread,
                        autoArchiveDuration: 1440,
                        reason: 'Holonic Proxy deliberation for reply node.'
                    });

                    const shadowEmbed = new EmbedBuilder()
                        .setTitle(`🏛️ Holonic Proxy Vote Required`)
                        .setDescription(`**Target Node:** <#${bouncerChannelId}>\n**Action:** \`join_plur\`\n\n**Target Network:**\n${displayPayload}\n\n*Our collective is registered as a citizen of the target node. We must vote to cast our proxy vote.*`)
                        .setColor('#9b59b6')
                        .setFooter({ text: `Requires ${SHADOW_REQ} local votes to lock in our collective decision.` }); 

                    const shadowApprove = new ButtonBuilder().setCustomId(`vote_yes_${shadowPropId}`).setLabel(`Vote YES (0/${SHADOW_REQ})`).setStyle(ButtonStyle.Success);
                    const shadowReject = new ButtonBuilder().setCustomId(`vote_no_${shadowPropId}`).setLabel(`Vote NO (0/${SHADOW_REQ})`).setStyle(ButtonStyle.Danger);

                    const shadowVoteMsg = await shadowThread.send({ 
                        content: `**ATTENTION CITIZENS:** A parent node requires our proxy vote.`,
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