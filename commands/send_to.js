const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('send_to')
        .setDescription('Propose a message to send to a specific plur.')
        .addChannelOption(option => option.setName('target').setDescription('The destination channel').setRequired(true))
        .addStringOption(option => option.setName('message').setDescription('The message payload').setRequired(true)),

    async execute(interaction, db) {
        await interaction.deferReply();
        const targetChannel = interaction.options.getChannel('target');
        const proposalText = interaction.options.getString('message');
        const channelId = interaction.channelId;

        const registeredVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [channelId]);
        if (registeredVoters.length === 0) return interaction.editReply('⚠️ No active nodes. Run `/opt_in` first.');

        const REQUIRED_VOTES = Math.floor(registeredVoters.length / 2) + 1;
        const validVoterIds = registeredVoters.map(v => v.user_id);

        const embed = new EmbedBuilder()
            .setTitle(`📤 Outbound Proposal to #${targetChannel.name}`)
            .setDescription(`**Payload:**\n${proposalText}`)
            .setColor('#3498db')
            .setFooter({ text: `Requires ${REQUIRED_VOTES} votes for consensus.` });

        const approveButton = new ButtonBuilder().setCustomId('approve_send').setLabel('Approve (0)').setStyle(ButtonStyle.Success);
        const response = await interaction.editReply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(approveButton)] });
        
        const collector = response.createMessageComponentCollector({ filter: i => i.customId === 'approve_send', time: 600000 });
        let votes = new Set();

        collector.on('collect', async i => {
            if (!validVoterIds.includes(i.user.id)) return i.reply({ content: '🚫 Viewers cannot vote.', ephemeral: true });
            if (votes.has(i.user.id)) return i.reply({ content: 'Vote locked.', ephemeral: true });
            
            votes.add(i.user.id);
            
            // 🛡️ FIX
            await i.deferUpdate();

            if (votes.size >= REQUIRED_VOTES) {
                collector.stop('passed');
                
                const targetEmbed = new EmbedBuilder().setTitle(`Incoming from #${interaction.channel.name}`).setDescription(proposalText).setColor('#9b59b6');
                await targetChannel.send({ embeds: [targetEmbed] });

                // 🔄 FIX
                await i.editReply({ embeds: [EmbedBuilder.from(embed).setColor('#2ecc71').setTitle('📤 Outbound Payload [SENT]')], components: [] });
            } else {
                approveButton.setLabel(`Approve (${votes.size}/${REQUIRED_VOTES})`);
                // 🔄 FIX
                await i.editReply({ components: [new ActionRowBuilder().addComponents(approveButton)] });
            }
        });
    }
};