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
                    { name: 'Establish Bridge (Listen)', value: 'establish_bridge' },
                    { name: 'Toggle Borders (Open/Close)', value: 'toggle_borders' },
                    { name: 'Admit Citizen (Sponsor)', value: 'admit_citizen' },
                    { name: 'Local Action (Pin)', value: 'local_action' }
                )
        )
        .addStringOption(option => 
            option.setName('payload')
                .setDescription('The message, @user, or parameter to vote on.')
                .setRequired(true)
        ),

    async execute(interaction, db) {
        const proposalType = interaction.options.getString('type');
        const payloadText = interaction.options.getString('payload');
        
        const bouncerChannelId = interaction.channel.isThread() ? interaction.channel.parentId : interaction.channelId;
        const isCitizen = await db.get(`SELECT * FROM plur_members WHERE plur_channel_id = ? AND user_id = ?`, [bouncerChannelId, interaction.user.id]);
        
        if (!isCitizen) {
            return interaction.reply({ 
                content: '⚠️ You must be an active citizen to initiate a proposal. Run `/opt_in` first.', 
                flags: MessageFlags.Ephemeral 
            });
        }

        const registeredVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [bouncerChannelId]);
        if (registeredVoters.length === 0) {
            return interaction.reply({ content: '⚠️ Node is empty. Run `/opt_in` first.', flags: MessageFlags.Ephemeral });
        }

        const REQUIRED_VOTES = Math.floor(registeredVoters.length / 2) + 1;
        const proposalId = `prop_${Date.now()}`;

        await db.run(`
            INSERT INTO active_proposals (proposal_id, channel_id, author_id, proposal_type, payload, required_votes)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [proposalId, bouncerChannelId, interaction.user.id, proposalType, payloadText, REQUIRED_VOTES]);

        await interaction.reply({ content: `✅ Proposal logged. Generating consensus thread...`, flags: MessageFlags.Ephemeral });

        let targetChannel = interaction.channel;
        if (!interaction.channel.isThread()) {
            let threadPrefix = '🛠️ Local Action';
            if (proposalType === 'global_broadcast') threadPrefix = '📡 Global Transmit';
            if (proposalType === 'establish_bridge') threadPrefix = '🌉 Network Bridge';
            if (proposalType === 'toggle_borders') threadPrefix = '🛡️ Border Policy';
            if (proposalType === 'admit_citizen') threadPrefix = '🛂 Immigration';

            targetChannel = await interaction.channel.threads.create({
                name: `Vote: ${threadPrefix}`,
                type: ChannelType.PublicThread,
                autoArchiveDuration: 1440,
                reason: 'Dedicated node voting and deliberation thread.'
            });
        }

        const embed = new EmbedBuilder()
            .setTitle(`🏛️ Node Consensus Required`)
            .setDescription(`**Author:** <@${interaction.user.id}>\n**Action:** \`${proposalType}\`\n\n**Payload:**\n${payloadText}`)
            .setColor('#3498db')
            .setFooter({ text: `Requires ${REQUIRED_VOTES} citizen votes to execute or reject.` }); 

        const approveButton = new ButtonBuilder()
            .setCustomId(`vote_yes_${proposalId}`)
            .setLabel(`Approve (0/${REQUIRED_VOTES})`)
            .setStyle(ButtonStyle.Success);

        const rejectButton = new ButtonBuilder()
            .setCustomId(`vote_no_${proposalId}`)
            .setLabel(`Reject (0/${REQUIRED_VOTES})`)
            .setStyle(ButtonStyle.Danger);

        await targetChannel.send({ 
            content: `<@${interaction.user.id}> has initiated a vote. Discuss and lock in below.`, 
            embeds: [embed], 
            components: [new ActionRowBuilder().addComponents(approveButton, rejectButton)] 
        });
    }
};