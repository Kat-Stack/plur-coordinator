const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('join_plur')
        .setDescription('Propose a vote to intercept and listen to another plur.')
        // Changed from ChannelOption to StringOption to allow external Server IDs
        .addStringOption(option =>
            option.setName('target_id')
                .setDescription('The exact Channel ID of the plur you want to bridge to')
                .setRequired(true)),

    async execute(interaction, db) {
        await interaction.deferReply();
        // Read the string ID the user pasted
        const targetId = interaction.options.getString('target_id').trim();
        const channelId = interaction.channelId;

        if (targetId === channelId) return interaction.editReply("❌ You cannot bridge to your own channel.");

        // Ask the bot if it can actually see this channel anywhere in its connected servers
        const targetChannel = await interaction.client.channels.fetch(targetId).catch(() => null);
        if (!targetChannel) {
            return interaction.editReply("❌ Cannot locate that channel. Ensure the ID is correct and the bot is in that server.");
        }

        const registeredVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [channelId]);
        if (registeredVoters.length === 0) return interaction.editReply('⚠️ No active nodes. Run `/opt_in` first.');

        const REQUIRED_VOTES = Math.floor(registeredVoters.length / 2) + 1;
        const validVoterIds = registeredVoters.map(v => v.user_id);

        const embed = new EmbedBuilder()
            .setTitle('🔗 Bridge Proposal: Listen')
            .setDescription(`**Proposed by:** <@${interaction.user.id}>\n**Action:** Establish a one-way listening bridge to node \`${targetChannel.name}\` (ID: ${targetId}).`)
            .setColor('#f39c12')
            .setFooter({ text: `Requires ${REQUIRED_VOTES} votes for consensus.` });

        const approveButton = new ButtonBuilder().setCustomId('approve_join').setLabel('Approve (0)').setStyle(ButtonStyle.Success);
        const row = new ActionRowBuilder().addComponents(approveButton);

        await interaction.editReply({ embeds: [embed], components: [row] });
        
        // Fetch original reply for the unkillable collector
        const responseMessage = await interaction.fetchReply();
        const collector = responseMessage.createMessageComponentCollector({ filter: i => i.customId === 'approve_join', time: 600000 });
        let votes = new Set();

        collector.on('collect', async i => {
            try {
                if (!validVoterIds.includes(i.user.id)) return await i.reply({ content: '🚫 Viewers cannot vote.', ephemeral: true });
                if (votes.has(i.user.id)) return await i.reply({ content: 'Vote locked.', ephemeral: true });
                
                votes.add(i.user.id);
                
                try {
                    await i.deferUpdate();
                } catch (ackErr) {
                    console.warn("⚠️ API lag ignored.");
                }

                if (votes.size >= REQUIRED_VOTES) {
                    collector.stop('passed');
                    await db.run(`INSERT OR IGNORE INTO plur_connections (listening_plur_id, target_plur_id) VALUES (?, ?)`, [channelId, targetId]);
                    
                    const passedEmbed = EmbedBuilder.from(embed).setColor('#2ecc71').setTitle('🔗 Bridge [ESTABLISHED]');
                    await interaction.editReply({ embeds: [passedEmbed], components: [] });
                    await interaction.channel.send(`✅ We are now actively intercepting transmissions from **${targetChannel.name}**.`);
                } else {
                    approveButton.setLabel(`Approve (${votes.size}/${REQUIRED_VOTES})`);
                    await interaction.editReply({ components: [new ActionRowBuilder().addComponents(approveButton)] });
                }
            } catch (err) {
                console.error("Collector error:", err);
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason !== 'passed') interaction.editReply({ embeds: [EmbedBuilder.from(embed).setColor('#e74c3c').setTitle('🔗 Bridge Proposal [FAILED]')], components: [] }).catch(() => {});
        });
    }
};