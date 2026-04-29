const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Display the manual for the Plur Coordination Network.'),

    async execute(interaction) {
        const embed = new EmbedBuilder()
            .setTitle('🗃️ Plur Network Architecture & Commands')
            .setDescription('Welcome to the mesh. This node operates on a 51% consensus ruleset. Here is how to interface with the network:')
            .setColor('#9b59b6')
            .addFields(
                { 
                    name: '🔌 Initialization', 
                    value: '`/opt_in` - Register as an active voting agent in this node.\n`/setup_global` - (Admin) Designate this channel as the main network hub.\n`/create_plur` - (Admin) Spawn a new localized coordination cell.' 
                },
                { 
                    name: '📡 Network Actions (Requires Consensus)', 
                    value: '`/propose <message>` - Broadcast a payload to ALL connected servers.\n`/send_to <target> <message>` - Fire a payload to one specific plur.\n`/join_plur <target_id>` - Establish a listening bridge to intercept another node.' 
                }
            )
            .setFooter({ text: 'Observe. Self-React. Interact. (OSRI)' });

        await interaction.reply({ embeds: [embed] });
    }
};