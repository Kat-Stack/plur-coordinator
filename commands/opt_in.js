const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('opt_in')
        .setDescription('Register as a voting citizen of this node.'),

    async execute(interaction, db) {
        const channelId = interaction.channelId;

        const existing = await db.get(`SELECT * FROM plur_members WHERE plur_channel_id = ? AND user_id = ?`, [channelId, interaction.user.id]);
        if (existing) {
            return interaction.reply({ content: '✅ You are already a registered citizen of this node.', flags: MessageFlags.Ephemeral });
        }

        const settings = await db.get(`SELECT is_closed FROM plur_settings WHERE channel_id = ?`, [channelId]);
        
        if (settings && settings.is_closed === 1) {
            const registeredVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [channelId]);
            if (registeredVoters.length === 0) return interaction.reply({ content: '⛔ Node is locked and has no citizens to approve your request.', flags: MessageFlags.Ephemeral });

            const REQUIRED_VOTES = Math.floor(registeredVoters.length / 2) + 1;
            const proposalId = `prop_${Date.now()}`;

            const thread = await interaction.channel.threads.create({
                name: `🛂 Entrance: ${interaction.user.username}`,
                type: ChannelType.PublicThread,
                autoArchiveDuration: 1440,
                reason: 'Citizen application.'
            });

            const embed = new EmbedBuilder()
                .setTitle(`🛂 Citizenship Application`)
                .setDescription(`**Applicant:** <@${interaction.user.id}>\n\nThis node's borders are currently **CLOSED**. The applicant is requesting entry.`)
                .setColor('#e67e22')
                .setFooter({ text: `Requires ${REQUIRED_VOTES} citizen votes to approve.` });

            const approveButton = new ButtonBuilder().setCustomId(`vote_yes_${proposalId}`).setLabel(`Approve (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Success);
            const rejectButton = new ButtonBuilder().setCustomId(`vote_no_${proposalId}`).setLabel(`Reject (0/${REQUIRED_VOTES})`).setStyle(ButtonStyle.Danger);

            const voteMsg = await thread.send({ embeds: [embed], components: [new ActionRowBuilder().addComponents(approveButton, rejectButton)] });

            await db.run(`INSERT INTO active_proposals (proposal_id, channel_id, thread_id, message_id, author_id, proposal_type, payload, required_votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                [proposalId, channelId, thread.id, voteMsg.id, interaction.user.id, 'admit_citizen', interaction.user.id, REQUIRED_VOTES]);

            const collectiveCitizens = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ? AND member_type = 'plur'`, [channelId]);
            for (const collective of collectiveCitizens) {
                try {
                    const shadowChannel = await interaction.client.channels.fetch(collective.user_id).catch(() => null);
                    if (shadowChannel) {
                        const shadowVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [collective.user_id]);
                        if (shadowVoters.length === 0) continue; 
                        
                        const SHADOW_REQ = Math.floor(shadowVoters.length / 2) + 1;
                        const shadowPropId = `prop_shadow_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

                        const shadowThread = await shadowChannel.threads.create({
                            name: `🏛️ Proxy Vote: New Applicants`,
                            type: ChannelType.PublicThread,
                            autoArchiveDuration: 1440,
                            reason: 'Holonic Proxy deliberation for parent node application.'
                        });

                        const shadowEmbed = new EmbedBuilder()
                            .setTitle(`🏛️ Holonic Proxy Vote Required`)
                            .setDescription(`**Target Hub:** <#${channelId}>\n**Action:** \`admit_citizen\`\n\n**Applicant:** <@${interaction.user.id}>\n\n*Our collective must vote to cast our proxy vote on admitting this human.*`)
                            .setColor('#9b59b6')
                            .setFooter({ text: `Requires ${SHADOW_REQ} local votes to lock in.` }); 

                        const shadowApprove = new ButtonBuilder().setCustomId(`vote_yes_${shadowPropId}`).setLabel(`Vote YES (0/${SHADOW_REQ})`).setStyle(ButtonStyle.Success);
                        const shadowReject = new ButtonBuilder().setCustomId(`vote_no_${shadowPropId}`).setLabel(`Vote NO (0/${SHADOW_REQ})`).setStyle(ButtonStyle.Danger);

                        const shadowVoteMsg = await shadowThread.send({ embeds: [shadowEmbed], components: [new ActionRowBuilder().addComponents(shadowApprove, shadowReject)] });
                        
                        await db.run(`INSERT INTO active_proposals (proposal_id, channel_id, thread_id, message_id, author_id, proposal_type, payload, required_votes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
                            [shadowPropId, collective.user_id, shadowThread.id, shadowVoteMsg.id, 'HOLONIC_SYSTEM', 'holonic_proxy', proposalId, SHADOW_REQ]);

                        await db.run(`INSERT OR IGNORE INTO thread_links (parent_thread_id, shadow_thread_id) VALUES (?, ?)`, [thread.id, shadowThread.id]);
                    }
                } catch (err) { }
            }

            return interaction.reply({ content: '🚪 **Application Submitted.** This node has closed its cell walls. An entrance request has been sent for review.', flags: MessageFlags.Ephemeral });
        }

        await db.run(`INSERT INTO plur_members (plur_channel_id, user_id) VALUES (?, ?)`, [channelId, interaction.user.id]);
        await interaction.reply({ content: `🛂 **Citizenship Granted.** You now have voting rights in <#${channelId}>.` });
    }
};