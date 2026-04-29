const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup_global')
        .setDescription('Designates the current channel as the Global Feed for this server.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction, db) {
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;

        try {
            await db.run(`
                INSERT INTO globals (guild_id, channel_id) 
                VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET channel_id = ?
            `, [guildId, channelId, channelId]);

            // Ephemeral confirmation
            await interaction.reply({ 
                content: `✅ Success! This channel (<#${channelId}>) is now the designated Global Feed.`, 
                ephemeral: true 
            });
            
            const welcomeEmbed = new EmbedBuilder()
                .setTitle('🌐 Node Initialized: Welcome to the Mesh')
                .setDescription('This channel is now actively connected to the broader mycelial network. To participate in cross-server consensus, you must register as a voting agent.')
                .setColor('#3498db')
                .addFields(
                    { name: 'Step 1: Become a Node', value: 'Run `/opt_in` to gain voting rights.' },
                    { name: 'Step 2: Propose Action', value: 'Run `/propose` to draft a network-wide broadcast.' },
                    { name: 'Step 3: Build Bridges', value: 'Run `/join_plur` with a target ID to subscribe to other collectives.' },
                    { name: 'Need the full manual?', value: 'Run `/help` at any time to see all network capabilities.' }
                );

            // SEND EXACTLY ONCE
            const welcomeMessage = await interaction.channel.send({ embeds: [welcomeEmbed] });
            
            // PIN PROTOCOL
            try {
                await welcomeMessage.pin();
                console.log(`📌 Successfully pinned manual in ${interaction.guild.name}`);
            } catch (pinErr) {
                console.error("\n❌ --- PIN ACTION FAILED ---");
                console.error(pinErr);
                console.error("---------------------------\n");
                
                await interaction.followUp({ 
                    content: '⚠️ I tried to pin the manual, but Discord blocked me. Check the bot console for the exact error.', 
                    ephemeral: true 
                });
            }
            
        } catch (error) {
            console.error("Database error:", error);
            // Fallback in case it hasn't been replied to yet
            if (!interaction.replied) {
                await interaction.reply({ 
                    content: '❌ There was an error saving this to the database.', 
                    ephemeral: true 
                });
            }
        }
    },
};