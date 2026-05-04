const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ChannelType } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('opt_in')
        .setDescription('Register as a voting citizen of this node.'),

    async execute(interaction, db) {
        const channelId = interaction.channelId;

        // 1. Check if they are already a citizen
        const existing = await db.get(`SELECT * FROM plur_members WHERE plur_channel_id = ? AND user_id = ?`, [channelId, interaction.user.id]);
        if (existing) {
            return interaction.reply({ content: '✅ You are already a registered citizen of this node.', flags: MessageFlags.Ephemeral });
        }

        // 2. Check the border status
        const settings = await db.get(`SELECT is_closed FROM plur_settings WHERE channel_id = ?`, [channelId]);
        
        if (settings && settings.is_closed === 1) {
            // --- APPLICATION SYSTEM (BORDERS CLOSED) ---
            const registeredVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [channelId]);
            if (registeredVoters.length === 0) {
                return interaction.reply({ content: '⛔ Node is locked and has no citizens to approve your request.', flags: MessageFlags.Ephemeral });
            }

            const REQUIRED_VOTES = Math.floor(registeredVoters.length / 2) + 1;
            const proposalId = `prop_${Date.now()}`;

            // Save the application as a formal proposal using their User ID as the payload
            await db.run(`
                INSERT INTO active_proposals (proposal_id, channel_id, author_id, proposal_type, payload, required_votes)
                VALUES (?, ?, ?, ?, ?, ?)
            `, [proposalId, channelId, interaction.user.id, 'admit_citizen', interaction.user.id, REQUIRED_VOTES]);

            // Create the immigration thread
            const thread = await interaction.channel.threads.create({
                name: `🛂 Immigration: ${interaction.user.username}`,
                type: ChannelType.PublicThread,
                autoArchiveDuration: 1440,
                reason: 'Citizen application.'
            });

            const embed = new EmbedBuilder()
                .setTitle(`🛂 Citizenship Application`)
                .setDescription(`**Applicant:** <@${interaction.user.id}>\n\nThis node's borders are currently **CLOSED**. The applicant is requesting entry.`)
                .setColor('#e67e22')
                .setFooter({ text: `Requires ${REQUIRED_VOTES} citizen votes to approve.` });

            const approveButton = new ButtonBuilder()
                .setCustomId(`vote_yes_${proposalId}`)
                .setLabel(`Approve (0/${REQUIRED_VOTES})`)
                .setStyle(ButtonStyle.Success);

            const rejectButton = new ButtonBuilder()
                .setCustomId(`vote_no_${proposalId}`)
                .setLabel(`Reject (0/${REQUIRED_VOTES})`)
                .setStyle(ButtonStyle.Danger);

            await thread.send({ 
                embeds: [embed], 
                components: [new ActionRowBuilder().addComponents(approveButton, rejectButton)] 
            });

            // Tell the applicant they are in the waiting room
            return interaction.reply({ 
                content: '🚪 **Application Submitted.** This node has closed its borders. A join request has been sent to the active citizens for review.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        // --- DIRECT ENTRY (BORDERS OPEN) ---
        await db.run(`INSERT INTO plur_members (plur_channel_id, user_id) VALUES (?, ?)`, [channelId, interaction.user.id]);
        
        await interaction.reply({ 
            content: `🛂 **Citizenship Granted.** You now have voting rights in <#${channelId}>.` 
        });
    }
};