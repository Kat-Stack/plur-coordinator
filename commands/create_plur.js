const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('create_plur')
        .setDescription('Spawns a new plur channel for internal coordination.')
        .addStringOption(option =>
            option.setName('name')
                .setDescription('The designation/name of this plur')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels), // Keeps it secure to organizers

    async execute(interaction, db) {
        const plurName = interaction.options.getString('name');
        
        try {
            // Tells Discord to create a new text channel
            const channel = await interaction.guild.channels.create({
                name: plurName,
                type: ChannelType.GuildText,
            });

            await interaction.reply({ 
                content: `✅ Plur established! The new internal space is ready: <#${channel.id}>` 
            });
            
        } catch (error) {
            console.error("Error creating plur:", error);
            await interaction.reply({ 
                content: '❌ Systems failing: Could not create the plur channel. Check bot permissions.', 
                ephemeral: true 
            });
        }
    },
};