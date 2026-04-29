require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    Collection, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle, 
    ModalBuilder, 
    TextInputBuilder, 
    TextInputStyle,
    MessageFlags
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const { initDB } = require('./db.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
});

// --- COMMAND LOADER ---
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    try {
        const command = require(filePath);
        if ('data' in command && 'execute' in command) {
            client.commands.set(command.data.name, command);
        }
    } catch (err) {
        console.error(`\n🚨 FATAL ERROR LOADING COMMAND: ${file}`);
        console.error(`Check this file for missing brackets or bad copy-pastes!`);
        console.error(err.message + `\n`);
    }
}

// --- BOOT SEQUENCE ---
client.once('clientReady', async (c) => { 
    try {
        console.log(`-----------------------------------------`);
        console.log(`NETWORK ONLINE: ${c.user.tag}`);
        
        client.db = await initDB(); 
        
        console.log(`DATABASE: Memory systems fully operational.`);
        console.log(`-----------------------------------------`);
    } catch (err) {
        console.error("Critical failure during boot:", err);
    }
});

// --- INTERACTION HANDLER ---
client.on('interactionCreate', async interaction => {
    
    // PART A: BUTTONS (Response Initiation)
    if (interaction.isButton() && interaction.customId.startsWith('initiate_response_')) {
        const [,, messageId, targetChannelId] = interaction.customId.split('_');
        const modal = new ModalBuilder()
            .setCustomId(`modal_response_${messageId}_${targetChannelId}`)
            .setTitle('Propose Collective Response');
        
        const responseInput = new TextInputBuilder()
            .setCustomId('response_text')
            .setLabel("What should the collective say?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(responseInput));
        return await interaction.showModal(modal);
    }

    // PART B: MODAL SUBMISSION (Consensus Voting)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_response_')) {
        const [,, messageId, targetChannelId] = interaction.customId.split('_');
        const responseText = interaction.fields.getTextInputValue('response_text');
        
        const registeredVoters = await client.db.all(`SELECT user_id FROM plur_members WHERE plur_channel_id = ?`, [interaction.channelId]);
        const REQUIRED_VOTES = Math.floor(registeredVoters.length / 2) + 1;
        const validVoterIds = registeredVoters.map(v => v.user_id);

        const voteEmbed = new EmbedBuilder()
            .setTitle('🗳️ Collective Action Proposal')
            .setDescription(`**Proposed Response:**\n"${responseText}"`)
            .setColor('#e67e22')
            .setFooter({ text: `Requires ${REQUIRED_VOTES} votes to execute.` });

        const btn = new ButtonBuilder()
            .setCustomId('confirm_action')
            .setLabel(`Approve (0/${REQUIRED_VOTES})`)
            .setStyle(ButtonStyle.Success);
        
        const voteMsg = await interaction.reply({ 
            embeds: [voteEmbed], 
            components: [new ActionRowBuilder().addComponents(btn)],
            withResponse: true 
        });

        // Use fetchReply so we can attach the collector directly to the raw message
        const responseMessage = await interaction.fetchReply();

        const collector = responseMessage.createMessageComponentCollector({ 
            filter: i => i.customId === 'confirm_action',
            time: 600000 
        });

        let votes = new Set();

        collector.on('collect', async i => {
            try {
                if (!validVoterIds.includes(i.user.id)) {
                    return await i.reply({ content: '🚫 Registered nodes only.', flags: [MessageFlags.Ephemeral] });
                }
                if (votes.has(i.user.id)) {
                    return await i.reply({ content: 'Already voted.', flags: [MessageFlags.Ephemeral] });
                }
                
                votes.add(i.user.id);

                // 🛡️ UNKILLABLE FIX
                try {
                    await i.deferUpdate();
                } catch (ackErr) {
                    console.warn("⚠️ Discord API hiccup ignored.");
                }

                if (votes.size >= REQUIRED_VOTES) {
                    collector.stop();
                    const targetChannel = await client.channels.fetch(targetChannelId).catch(() => null);
                    if (targetChannel) {
                        await targetChannel.send({ 
                            content: `**[#${interaction.channel.name} ${interaction.guild.name}]:** ${responseText}`,
                            reply: { messageReference: messageId }
                        });
                    }
                    
                    // Edit the 15-minute interaction token
                    await interaction.editReply({ 
                        embeds: [EmbedBuilder.from(voteEmbed).setTitle('✅ ACTION EXECUTED').setColor('#2ecc71')], 
                        components: [] 
                    });
                } else {
                    btn.setLabel(`Approve (${votes.size}/${REQUIRED_VOTES})`);
                    await interaction.editReply({ components: [new ActionRowBuilder().addComponents(btn)] });
                }
            } catch (fatalErr) {
                console.error("Critical collector failure:", fatalErr);
            }
        });
        return;
    }

    // PART C: SLASH COMMANDS
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
        await command.execute(interaction, client.db);
    } catch (error) {
        console.error(error);
    }
});

// --- MESSAGE INTERCEPTOR ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const listeners = await client.db.all(`SELECT listening_plur_id FROM plur_connections WHERE target_plur_id = ?`, [message.channel.id]);
    
    if (listeners && listeners.length > 0) {
        for (const listener of listeners) {
            try {
                const listeningChannel = await client.channels.fetch(listener.listening_plur_id).catch(() => null);
                
                if (listeningChannel) {
                    const mirrorEmbed = new EmbedBuilder()
                        .setAuthor({ 
                            name: `${message.author.username} (@ ${message.guild.name})`, 
                            iconURL: message.author.displayAvatarURL() 
                        })
                        .setDescription(message.content || "*[Media]*")
                        .setColor('#2c3e50')
                        .setFooter({ text: `Source ID: ${message.id} | From #${message.channel.name}` });

                    const btn = new ButtonBuilder()
                        .setCustomId(`initiate_response_${message.id}_${message.channel.id}`) // Fixed template literal here
                        .setLabel('Propose Response')
                        .setStyle(ButtonStyle.Primary);

                    await listeningChannel.send({ 
                        embeds: [mirrorEmbed], 
                        components: [new ActionRowBuilder().addComponents(btn)] 
                    });
                }
            } catch (err) {
                console.error("Intercept failed:", err);
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);