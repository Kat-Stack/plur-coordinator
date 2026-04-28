const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('propose')
        .setDescription('Broadcast a message to the ENTIRE plur network.')
        .addStringOption(option => 
            option.setName('message')
                .setDescription('The payload you want to broadcast')
                .setRequired(true)
        ),

    async execute(interaction, db) {
        const proposalText = interaction.options.getString('message');
        const channelId = interaction.channelId;

        const allGlobals = await db.all(`SELECT channel_id FROM globals`);
        
        if (allGlobals.length === 0) return interaction.reply({ content: '❌ No Global Feeds have been set up in the network yet.', ephemeral: true });

        const registeredVoters = await db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [channelId]);
        
        if (registeredVoters.length === 0) return interaction.reply({ content: '⚠️ No registered voters here. Run `/opt_in` first.', ephemeral: true });

        const totalVoters = registeredVoters.length;
        const REQUIRED_VOTES = Math.floor(totalVoters / 2) + 1;
        const validVoterIds = registeredVoters.map(voter => voter.user_id);

        const embed = new EmbedBuilder()
            .setTitle('🌐 Network-Wide Proposal')
            .setDescription(`**Proposed by:** <@${interaction.user.id}>\n\n**Payload:**\n${proposalText}`)
            .setColor('#3498db')
            .setFooter({ text: `Requires ${REQUIRED_VOTES} votes to broadcast to ${allGlobals.length} servers.` }); 

        const approveButton = new ButtonBuilder()
            .setCustomId('approve_proposal')
            .setLabel(`Approve (0/${REQUIRED_VOTES})`)
            .setStyle(ButtonStyle.Success);

        await interaction.reply({ embeds: [embed], components: [new ActionRowBuilder().addComponents(approveButton)]});
        const responseMessage = await interaction.fetchReply();

        const filter = i => i.customId === 'approve_proposal';
        const collector = responseMessage.createMessageComponentCollector({ filter, time: 600000 }); 

        let votes = new Set();

        collector.on('collect', async i => {
            try {
                if (!validVoterIds.includes(i.user.id)) return await i.reply({ content: '🚫 Viewers cannot trigger network-wide broadcasts.', ephemeral: true });
                if (votes.has(i.user.id)) return await i.reply({ content: 'Vote already locked.', ephemeral: true });
                
                votes.add(i.user.id);
                
                try {
                    await i.deferUpdate();
                } catch (ackErr) {
                    console.warn("⚠️ Discord API hiccup ignored.");
                }

                if (votes.size >= REQUIRED_VOTES) {
                    collector.stop('passed');
                    
                    await interaction.editReply({ 
                        embeds: [EmbedBuilder.from(embed).setColor('#f39c12').setTitle(`🌐 BROADCASTING TO ${allGlobals.length} SERVERS...`)], 
                        components: [] 
                    });
                    
                    let successCount = 0;
                    for (const entry of allGlobals) {
                        try {
                            const targetChannel = await interaction.client.channels.fetch(entry.channel_id).catch(() => null);
                            
                            if (targetChannel) {
                                const globalEmbed = new EmbedBuilder()
                                    .setTitle(`📡 Incoming Transmission from the Network`)
                                    .setAuthor({ 
                                        name: `Origin: ${interaction.guild.name} (#${interaction.channel.name})`, 
                                        iconURL: interaction.guild.iconURL() 
                                    })
                                    .setDescription(proposalText)
                                    .setColor('#2ecc71')
                                    // 🔗 THE BRIDGE: Display the origin ID clearly so other nodes can copy it
                                    .addFields({ 
                                        name: '🔗 Establish Intercept Bridge', 
                                        value: `To subscribe to this node, run:\n\`/join_plur target_id: ${channelId}\`` 
                                    })
                                    .setTimestamp();

                                await targetChannel.send({ embeds: [globalEmbed] });
                                successCount++;
                            }
                        } catch (err) {
                            console.error(`Could not send to channel ${entry.channel_id}:`, err);
                        }
                    }

                    await interaction.editReply({ 
                        embeds: [EmbedBuilder.from(embed).setColor('#2ecc71').setTitle(`🌐 BROADCAST COMPLETE (${successCount} Servers)`)], 
                        components: [] 
                    });
                    
                } else {
                    approveButton.setLabel(`Approve (${votes.size}/${REQUIRED_VOTES})`);
                    await interaction.editReply({ components: [new ActionRowBuilder().addComponents(approveButton)] });
                }
            } catch (fatalErr) {
                console.error("Critical collector failure:", fatalErr);
            }
        });
    }
};