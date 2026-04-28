// Notice we added MessageFlags up here to fix the deprecation warning
const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('opt_in')
        .setDescription('Register as an active voting member in this plur.'),

    async execute(interaction, db) {
        // 1. Instantly pause the countdown timer and hide the "thinking" message
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const channelId = interaction.channelId;
        const userId = interaction.user.id;

        try {
            // 2. Run the database save (Even if OneDrive locks it, we have plenty of time)
            await db.run(`
                INSERT OR IGNORE INTO plur_members (plur_channel_id, user_id) 
                VALUES (?, ?)
            `, [channelId, userId]);

            // 3. Edit the deferred reply to show our success message
            await interaction.editReply({ 
                content: `✅ Acknowledged. You are now a registered voter in this plur.`
            });
            
        } catch (error) {
            console.error("Database error:", error);
            // We use editReply here too since the original reply was deferred
            await interaction.editReply({ 
                content: '❌ Systems failing: Could not register you in the database.'
            });
        }
    },
};