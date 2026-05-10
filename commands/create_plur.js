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

            // Register the new internal cell
            await db.run(`INSERT INTO node_registry (channel_id, plur_name) VALUES (?, ?)`, [channel.id, plurName]);
            const node = await db.get(`SELECT short_id FROM node_registry WHERE channel_id = ?`, [channel.id]);

            await interaction.reply({ 
                content: `✅ Plur established! The new internal space is ready: <#${channel.id}>\n**Internal ID:** \`${node.short_id}\` *(Use this ID to bridge to it)*` 
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