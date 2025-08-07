// ===== NETLIFY FUNCTIONS =====
// netlify/functions/webhook.js - Handle Cardano transaction webhooks
exports.handler = async (event, context) => {
    // Set CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    try {
        const { transaction, type, userId } = JSON.parse(event.body);
        
        // Verify webhook signature (implement your own logic)
        const webhookSecret = process.env.WEBHOOK_SECRET;
        
        if (type === 'deposit_confirmed') {
            // Update user balance in database
            await updateUserBalance(userId, transaction.amount);
            
            // Notify Discord bot
            await fetch(`${process.env.BOT_API_URL}/notify-deposit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    amount: transaction.amount,
                    txHash: transaction.hash
                })
            });
        }

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, processed: type })
        };
    } catch (error) {
        console.error('Webhook error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};

// netlify/functions/balance.js - Check user balance
exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { userId } = JSON.parse(event.body);
        
        if (!userId) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ error: 'Missing userId' })
            };
        }

        // Query Cardano blockchain via Blockfrost
        const balance = await getCardanoBalance(userId);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                userId, 
                balance: balance,
                timestamp: Date.now()
            })
        };
    } catch (error) {
        console.error('Balance check error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to check balance' })
        };
    }
};

// netlify/functions/generate-address.js - Generate deposit addresses
exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    try {
        const { userId } = JSON.parse(event.body);
        
        // Generate unique deposit address for user
        const depositAddress = await generateDepositAddress(userId);
        
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                userId,
                depositAddress,
                expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours
            })
        };
    } catch (error) {
        console.error('Address generation error:', error);
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to generate address' })
        };
    }
};

// Helper functions for Netlify functions
async function getCardanoBalance(userId) {
    // Implementation using Blockfrost API
    const response = await fetch(`https://cardano-mainnet.blockfrost.io/api/v0/addresses/${getUserAddress(userId)}`, {
        headers: {
            'project_id': process.env.BLOCKFROST_PROJECT_ID
        }
    });
    
    const data = await response.json();
    return parseFloat(data.amount[0].quantity) / 1000000; // Convert lovelace to ADA
}

async function generateDepositAddress(userId) {
    // In production, generate HD wallet addresses
    // For now, return a mock address
    return `addr1qx${userId.slice(0, 8)}example_deposit_address_here`;
}

async function updateUserBalance(userId, amount) {
    // Update user balance in your database
    // This would connect to your database service
    console.log(`Updating balance for ${userId}: +${amount} ADA`);
}

function getUserAddress(userId) {
    // Return user's Cardano address from database
    // Mock implementation
    return `addr1qx${userId.slice(0, 8)}example_user_address_here`;
}

// ===== MAIN DISCORD BOT (for VPS/Railway hosting) =====
// bot.js - Main Discord bot file
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const axios = require('axios');

class CardanoDiceBot {
    constructor() {
        this.client = new Client({ 
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] 
        });
        this.baseApiUrl = process.env.API_BASE_URL || 'https://api.swgyub.com/.netlify/functions';
        this.setupCommands();
        this.setupEvents();
    }

    setupCommands() {
        this.commands = new Map();
        
        // Balance command
        this.commands.set('balance', {
            data: new SlashCommandBuilder()
                .setName('balance')
                .setDescription('Check your ADA balance'),
            execute: async (interaction) => {
                await interaction.deferReply();
                
                try {
                    const response = await axios.post(`${this.baseApiUrl}/balance`, {
                        userId: interaction.user.id
                    });
                    
                    const { balance } = response.data;
                    
                    const embed = new EmbedBuilder()
                        .setColor(0x0099FF)
                        .setTitle('💰 Balance')
                        .setDescription(`Your balance: **${balance.toFixed(2)} ADA**`)
                        .setFooter({ text: 'swgyub.com • Cardano Dice Bot' })
                        .setTimestamp();
                    
                    await interaction.editReply({ embeds: [embed] });
                } catch (error) {
                    console.error('Balance check failed:', error);
                    await interaction.editReply('❌ Failed to check balance. Please try again.');
                }
            }
        });

        // Deposit command
        this.commands.set('deposit', {
            data: new SlashCommandBuilder()
                .setName('deposit')
                .setDescription('Get your deposit address'),
            execute: async (interaction) => {
                await interaction.deferReply({ ephemeral: true });
                
                try {
                    const response = await axios.post(`${this.baseApiUrl}/generate-address`, {
                        userId: interaction.user.id
                    });
                    
                    const { depositAddress } = response.data;
                    
                    const embed = new EmbedBuilder()
                        .setColor(0x00FF00)
                        .setTitle('💳 Deposit Address')
                        .setDescription('Send ADA to this address to fund your account:')
                        .addFields(
                            { name: 'Address', value: `\`\`\`${depositAddress}\`\`\`` },
                            { name: '⚠️ Important', value: '• Only send ADA to this address\n• Minimum deposit: 2 ADA\n• Address expires in 24 hours' }
                        )
                        .setFooter({ text: 'swgyub.com • Deposits are processed automatically' })
                        .setTimestamp();
                    
                    await interaction.editReply({ embeds: [embed] });
                } catch (error) {
                    console.error('Address generation failed:', error);
                    await interaction.editReply('❌ Failed to generate deposit address. Please try again.');
                }
            }
        });

        // Dice roll command
        this.commands.set('dice', {
            data: new SlashCommandBuilder()
                .setName('dice')
                .setDescription('Roll dice and bet ADA')
                .addNumberOption(option =>
                    option.setName('bet')
                        .setDescription('Amount of ADA to bet')
                        .setRequired(true)
                        .setMinValue(0.1)
                        .setMaxValue(100))
                .addIntegerOption(option =>
                    option.setName('prediction')
                        .setDescription('Predict the dice roll (1-6)')
                        .setRequired(true)
                        .setMinValue(1)
                        .setMaxValue(6)),
            execute: async (interaction) => {
                const bet = interaction.options.getNumber('bet');
                const prediction = interaction.options.getInteger('prediction');
                const userId = interaction.user.id;
                
                await interaction.deferReply();
                
                try {
                    // Check balance first
                    const balanceResponse = await axios.post(`${this.baseApiUrl}/balance`, { userId });
                    const balance = balanceResponse.data.balance;
                    
                    if (balance < bet) {
                        const embed = new EmbedBuilder()
                            .setColor(0xFF0000)
                            .setTitle('❌ Insufficient Balance')
                            .setDescription(`You need **${bet} ADA** but only have **${balance.toFixed(2)} ADA**`)
                            .addFields({ name: 'Get ADA', value: 'Use `/deposit` to fund your account' });
                        
                        await interaction.editReply({ embeds: [embed] });
                        return;
                    }
                    
                    // Generate provably fair random number
                    const serverSeed = this.generateServerSeed();
                    const clientSeed = interaction.user.id + Date.now();
                    const roll = this.generateFairRoll(serverSeed, clientSeed);
                    
                    const won = roll === prediction;
                    const multiplier = 5.5; // 5.5x payout for exact match
                    const payout = won ? bet * multiplier : 0;
                    
                    // Process the bet (would update database here)
                    await this.processBet(userId, bet, payout);
                    
                    const newBalance = balance - bet + payout;
                    
                    const embed = new EmbedBuilder()
                        .setColor(won ? 0x00FF00 : 0xFF0000)
                        .setTitle('🎲 Dice Roll Result')
                        .setDescription(`🎯 **Your Prediction:** ${prediction}\n🎲 **Dice Roll:** ${roll}`)
                        .addFields(
                            { name: 'Bet Amount', value: `${bet} ADA`, inline: true },
                            { name: 'Result', value: won ? '🎉 WIN!' : '😔 Loss', inline: true },
                            { name: 'Payout', value: won ? `${payout.toFixed(2)} ADA` : '0 ADA', inline: true },
                            { name: 'New Balance', value: `${newBalance.toFixed(2)} ADA` },
                            { name: 'Provably Fair', value: `Server: \`${serverSeed.slice(0, 8)}...\`\nClient: \`${clientSeed.toString().slice(0, 8)}...\`` }
                        )
                        .setFooter({ text: 'swgyub.com • Provably Fair Gaming' })
                        .setTimestamp();
                    
                    await interaction.editReply({ embeds: [embed] });
                    
                } catch (error) {
                    console.error('Dice roll failed:', error);
                    await interaction.editReply('❌ Failed to process dice roll. Please try again.');
                }
            }
        });

        // Stats command
        this.commands.set('stats', {
            data: new SlashCommandBuilder()
                .setName('stats')
                .setDescription('View your gaming statistics'),
            execute: async (interaction) => {
                await interaction.deferReply();
                
                // Mock stats - replace with database queries
                const stats = {
                    totalBets: 42,
                    totalWagered: 156.7,
                    totalWon: 89.3,
                    biggestWin: 27.5,
                    winRate: 45.2
                };
                
                const embed = new EmbedBuilder()
                    .setColor(0x9932CC)
                    .setTitle(`📊 Stats for ${interaction.user.username}`)
                    .addFields(
                        { name: 'Total Bets', value: stats.totalBets.toString(), inline: true },
                        { name: 'Total Wagered', value: `${stats.totalWagered} ADA`, inline: true },
                        { name: 'Total Won', value: `${stats.totalWon} ADA`, inline: true },
                        { name: 'Biggest Win', value: `${stats.biggestWin} ADA`, inline: true },
                        { name: 'Win Rate', value: `${stats.winRate}%`, inline: true },
                        { name: 'Profit/Loss', value: `${(stats.totalWon - stats.totalWagered).toFixed(2)} ADA`, inline: true }
                    )
                    .setFooter({ text: 'swgyub.com • Your Gaming Journey' })
                    .setTimestamp();
                
                await interaction.editReply({ embeds: [embed] });
            }
        });
    }

    setupEvents() {
        this.client.once('ready', () => {
            console.log(`✅ Bot logged in as ${this.client.user.tag}`);
            console.log(`🌐 API Base URL: ${this.baseApiUrl}`);
            this.registerSlashCommands();
        });
        
        this.client.on('interactionCreate', async (interaction) => {
            if (!interaction.isChatInputCommand()) return;
            
            const command = this.commands.get(interaction.commandName);
            if (!command) return;
            
            try {
                await command.execute(interaction);
            } catch (error) {
                console.error('Command error:', error);
                const errorEmbed = new EmbedBuilder()
                    .setColor(0xFF0000)
                    .setTitle('❌ Error')
                    .setDescription('An error occurred while executing this command.');
                
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ embeds: [errorEmbed] });
                } else {
                    await interaction.reply({ embeds: [errorEmbed] });
                }
            }
        });
    }

    async registerSlashCommands() {
        const commandData = Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());
        
        try {
            console.log('🔄 Refreshing slash commands...');
            await this.client.application.commands.set(commandData);
            console.log('✅ Slash commands registered successfully');
        } catch (error) {
            console.error('❌ Error registering slash commands:', error);
        }
    }

    generateServerSeed() {
        return require('crypto').randomBytes(32).toString('hex');
    }

    generateFairRoll(serverSeed, clientSeed) {
        const crypto = require('crypto');
        const combined = serverSeed + clientSeed;
        const hash = crypto.createHash('sha256').update(combined).digest('hex');
        const num = parseInt(hash.substring(0, 8), 16);
        return (num % 6) + 1;
    }

    async processBet(userId, bet, payout) {
        // In production, this would update your database
        console.log(`Processing bet for ${userId}: -${bet} ADA, +${payout} ADA`);
    }

    async start(token) {
        try {
            await this.client.login(token);
        } catch (error) {
            console.error('❌ Failed to start bot:', error);
        }
    }
}

// Start the bot
const bot = new CardanoDiceBot();
bot.start(process.env.DISCORD_TOKEN);

module.exports = { CardanoDiceBot };