const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    // 1. THIS IS THE DEFINITION: What Discord shows to the user
    data: new SlashCommandBuilder()
        .setName('setup_global')
        .setDescription('Designates the current channel as the Global Feed for this server.')
        // This ensures only server admins can set the global feed
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    // 2. THIS IS THE EXECUTION: What happens when someone presses enter
    async execute(interaction, db) {
        const guildId = interaction.guildId;
        const channelId = interaction.channelId;

        try {
            // We tell the database to save this channel. 
            // "ON CONFLICT" means if they run it again in a new channel, it overwrites the old one.
            await db.run(`
                INSERT INTO globals (guild_id, channel_id) 
                VALUES (?, ?)
                ON CONFLICT(guild_id) DO UPDATE SET channel_id = ?
            `, [guildId, channelId, channelId]);

            // The bot replies privately (ephemeral) so it doesn't clutter the channel
            await interaction.reply({ 
                content: `✅ Success! This channel (<#${channelId}>) is now the designated Global Feed.`, 
                ephemeral: true 
            });
            
        } catch (error) {
            console.error("Database error:", error);
            await interaction.reply({ 
                content: '❌ There was an error saving this to the database.', 
                ephemeral: true 
            });
        }
    },
};