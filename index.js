require('dotenv').config();
const { 
    Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags 
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const { initDB } = require('./db.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers
    ],
});

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
    } catch (err) { console.error(`🚨 FATAL ERROR: ${file}\n${err.message}`); }
}

client.once('clientReady', async (c) => { 
    try {
        console.log(`-----------------------------------------`);
        console.log(`NETWORK ONLINE: ${c.user.tag}`);
        client.db = await initDB(); 

        await client.db.exec(`
            CREATE TABLE IF NOT EXISTS active_proposals (
                proposal_id TEXT PRIMARY KEY, channel_id TEXT, author_id TEXT, proposal_type TEXT, payload TEXT, required_votes INTEGER
            );
            CREATE TABLE IF NOT EXISTS locked_votes (
                proposal_id TEXT, user_id TEXT, vote TEXT, PRIMARY KEY (proposal_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS plur_connections (
                target_plur_id TEXT, listening_plur_id TEXT, PRIMARY KEY (target_plur_id, listening_plur_id)
            );
            CREATE TABLE IF NOT EXISTS globals (
                guild_id TEXT PRIMARY KEY, channel_id TEXT
            );
            CREATE TABLE IF NOT EXISTS plur_settings (
                channel_id TEXT PRIMARY KEY, is_closed INTEGER DEFAULT 0
            );
        `);
        console.log(`DATABASE: Memory systems fully operational.`);
        console.log(`-----------------------------------------`);
    } catch (err) { console.error("Critical failure during boot:", err); }
});

client.on('interactionCreate', async interaction => {
    
    // --- GLOBAL VOTE LISTENER ---
    if (interaction.isButton() && (interaction.customId.startsWith('vote_yes_') || interaction.customId.startsWith('vote_no_'))) {
        const isYesVote = interaction.customId.startsWith('vote_yes_');
        const proposalId = interaction.customId.replace(isYesVote ? 'vote_yes_' : 'vote_no_', '');
        
        const proposal = await client.db.get(`SELECT * FROM active_proposals WHERE proposal_id = ?`, [proposalId]);
        if (!proposal) return interaction.reply({ content: '⚠️ This proposal has already been closed.', flags: MessageFlags.Ephemeral });

        const bouncerChannelId = interaction.channel.isThread() ? interaction.channel.parentId : interaction.channelId;
        const isCitizen = await client.db.get(`SELECT * FROM plur_members WHERE plur_channel_id = ? AND user_id = ?`, [bouncerChannelId, interaction.user.id]);
        if (!isCitizen) return interaction.reply({ content: '🚫 You are not a registered citizen of this plur.', flags: MessageFlags.Ephemeral });

        const hasVoted = await client.db.get(`SELECT * FROM locked_votes WHERE proposal_id = ? AND user_id = ?`, [proposalId, interaction.user.id]);
        if (hasVoted) return interaction.reply({ content: '🔒 Your vote is already locked in.', flags: MessageFlags.Ephemeral });

        await interaction.deferUpdate();
        await client.db.run(`INSERT INTO locked_votes (proposal_id, user_id, vote) VALUES (?, ?, ?)`, [proposalId, interaction.user.id, isYesVote ? 'yes' : 'no']);

        const yesData = await client.db.get(`SELECT COUNT(*) as count FROM locked_votes WHERE proposal_id = ? AND vote = 'yes'`, [proposalId]);
        const noData = await client.db.get(`SELECT COUNT(*) as count FROM locked_votes WHERE proposal_id = ? AND vote = 'no'`, [proposalId]);
        const yesVotes = yesData.count;
        const noVotes = noData.count;

        // CHECK WIN CONDITIONS
        if (yesVotes >= proposal.required_votes || noVotes >= proposal.required_votes) {
            await client.db.run(`DELETE FROM active_proposals WHERE proposal_id = ?`, [proposalId]);
            const passed = yesVotes >= proposal.required_votes;
            
            const embed = EmbedBuilder.from(interaction.message.embeds[0])
                .setTitle(passed ? '✅ CONSENSUS REACHED' : '❌ PROPOSAL REJECTED')
                .setColor(passed ? '#2ecc71' : '#e74c3c');
            
            await interaction.message.edit({ embeds: [embed], components: [] });

            // EXECUTE ACTIONS ONLY IF PASSED
            if (passed) {
                if (proposal.proposal_type === 'global_broadcast') {
                    const allGlobals = await client.db.all(`SELECT channel_id FROM globals`);
                    let successCount = 0;
                    for (const entry of allGlobals) {
                        try {
                            const targetChannel = await client.channels.fetch(entry.channel_id).catch(() => null);
                            if (targetChannel) {
                                const globalEmbed = new EmbedBuilder()
                                    .setTitle(proposal.payload)
                                    .setAuthor({ name: `#${interaction.channel.parent ? interaction.channel.parent.name : interaction.channel.name}, ${interaction.guild.name}`, iconURL: interaction.guild.iconURL() })
                                    .setDescription(`📡 Virtnet`)
                                    .setColor('#2ecc71')
                                    .setTimestamp();
                                await targetChannel.send({ embeds: [globalEmbed] });
                                successCount++;
                            }
                        } catch (err) { console.error(`Broadcast failed:`, err); }
                    }
                    await interaction.channel.send(`🌐 **Broadcast Executed.** Transmitted to ${successCount} nodes.`);
                
                } else if (proposal.proposal_type === 'establish_bridge') {
                    const targetId = proposal.payload.replace(/\D/g, ''); 
                    try {
                        await client.db.run(`INSERT OR IGNORE INTO plur_connections (target_plur_id, listening_plur_id) VALUES (?, ?)`, [targetId, bouncerChannelId]);
                        await interaction.channel.send(`🌉 **Bridge Established.** This node is now receiving transmissions from the target network.`);
                    } catch (err) {
                        await interaction.channel.send(`⛔ **Bridge Error.** Could not route connection.`);
                    }

                // NEW: BORDER TOGGLE
                } else if (proposal.proposal_type === 'toggle_borders') {
                    const setting = await client.db.get(`SELECT is_closed FROM plur_settings WHERE channel_id = ?`, [bouncerChannelId]);
                    const currentlyClosed = setting ? setting.is_closed : 0;
                    const newStatus = currentlyClosed ? 0 : 1;
                    
                    await client.db.run(`INSERT INTO plur_settings (channel_id, is_closed) VALUES (?, ?) ON CONFLICT(channel_id) DO UPDATE SET is_closed = ?`, [bouncerChannelId, newStatus, newStatus]);
                    await interaction.channel.send(`🛡️ **Border Policy Updated.** The node is now **${newStatus ? 'CLOSED' : 'OPEN'}** to new citizens.`);

                // NEW: ADMIT CITIZEN
                } else if (proposal.proposal_type === 'admit_citizen') {
                    const targetUserId = proposal.payload.replace(/\D/g, ''); 
                    if (!targetUserId) {
                        await interaction.channel.send(`⛔ **Error:** Could not extract a valid user ID from the payload.`);
                    } else {
                        await client.db.run(`INSERT OR IGNORE INTO plur_members (plur_channel_id, user_id) VALUES (?, ?)`, [bouncerChannelId, targetUserId]);
                        await interaction.channel.send(`🛂 **Citizen Admitted.** <@${targetUserId}> has been granted voting rights in this node.`);
                    }

                } else if (proposal.proposal_type === 'local_action') {
                    const parentChannel = await client.channels.fetch(bouncerChannelId).catch(() => null);
                    if (parentChannel) {
                        const directiveEmbed = new EmbedBuilder()
                            .setTitle('📜 Official Node Directive')
                            .setDescription(proposal.payload)
                            .setColor('#f1c40f')
                            .setFooter({ text: 'Ratified by Local Consensus' })
                            .setTimestamp();
                        const pinnedMsg = await parentChannel.send({ embeds: [directiveEmbed] });
                        await pinnedMsg.pin();
                        await interaction.channel.send(`🛠️ **Local Action Executed.** Directive pinned.`);
                    }
                }
            } else {
                await interaction.channel.send(`⛔ **Action Vetoed.** The network has rejected this payload.`);
            }

            // --- AUTO-THREAD CLEANUP ---
            if (interaction.channel.isThread()) {
                setTimeout(async () => {
                    await interaction.channel.setLocked(true, 'Consensus reached.');
                    await interaction.channel.setArchived(true, 'Consensus reached.');
                }, 3000); 
            }

        } else {
            const approveBtn = new ButtonBuilder().setCustomId(`vote_yes_${proposalId}`).setLabel(`Approve (${yesVotes}/${proposal.required_votes})`).setStyle(ButtonStyle.Success);
            const rejectBtn = new ButtonBuilder().setCustomId(`vote_no_${proposalId}`).setLabel(`Reject (${noVotes}/${proposal.required_votes})`).setStyle(ButtonStyle.Danger);
            await interaction.message.edit({ components: [new ActionRowBuilder().addComponents(approveBtn, rejectBtn)] });
        }
        return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try { await command.execute(interaction, client.db); } catch (error) { console.error(error); }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const listeners = await client.db.all(`SELECT listening_plur_id FROM plur_connections WHERE target_plur_id = ?`, [message.channel.id]);
    if (listeners && listeners.length > 0) {
        for (const listener of listeners) {
            try {
                const listeningChannel = await client.channels.fetch(listener.listening_plur_id).catch(() => null);
                if (listeningChannel) {
                    const mirrorEmbed = new EmbedBuilder()
                        .setAuthor({ name: `${message.author.username} (@ ${message.guild.name})`, iconURL: message.author.displayAvatarURL() })
                        .setDescription(message.content || "*[Media]*")
                        .setColor('#2c3e50')
                        .setFooter({ text: `Source ID: ${message.id} | From #${message.channel.name}` });

                    const sentMessage = await listeningChannel.send({ embeds: [mirrorEmbed] });
                    await sentMessage.startThread({ name: `Node Deliberation`, autoArchiveDuration: 1440, reason: 'Incoming transmission discussion space.' });
                }
            } catch (err) { console.error("Intercept failed:", err); }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);