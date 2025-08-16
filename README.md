# 🏴‍☠️ One Piece Discord Voice Bot v2.0

A Discord bot that creates dynamic voice channels with authentic One Piece locations and ships! Set sail with your crew, explore the Grand Line together, and track your voice activity with PostgreSQL persistence!

## ⭐ Features

- 🚢 **Dynamic Voice Channels** - Automatically creates channels when needed
- 🏝️ **Lore-Accurate Names** - 30+ authentic One Piece locations and ships
- 👑 **Captain Permissions** - Channel creators get admin rights
- 🌊 **Auto-Cleanup** - Empty crews disband automatically
- 🔐 **Permission Syncing** - New channels inherit category permissions
- 📊 **Voice Time Tracking** - PostgreSQL-powered analytics
- 🗄️ **Category Auto-Sync** - Remembers category location across restarts
- 🏴‍☠️ **Pirate Theme** - Full One Piece immersion with themed messages

## 🆕 What's New in v2.0

- ✅ **Removed Audio Features** - No more soundboard or voice detection
- ✅ **PostgreSQL Integration** - Persistent data storage
- ✅ **Permission Syncing** - Channels inherit category permissions
- ✅ **Voice Analytics** - Track user voice activity over time
- ✅ **Category Memory** - Bot remembers where you move the category
- ✅ **Enhanced Commands** - More detailed stats and bot information

## 🚀 Quick Start

### 1. Prerequisites
- Node.js 18+ installed
- PostgreSQL database running
- Discord Bot Token

### 2. Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd one-piece-discord-bot

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

### 3. Database Setup

```bash
# Create PostgreSQL database
createdb discord_bot

# Run the setup SQL (optional - bot creates tables automatically)
psql discord_bot < database_setup.sql
```

### 4. Configuration

Edit your `.env` file:

```env
# Discord Bot Configuration
DISCORD_TOKEN=your_actual_bot_token_here
CLIENT_ID=your_bot_client_id_here

# Bot Settings
CREATE_CHANNEL_NAME=🏴 Set Sail Together
CATEGORY_NAME=🌊 Grand Line Voice Channels
DELETE_DELAY=5000

# PostgreSQL Database
DATABASE_URL=postgresql://username:password@localhost:5432/discord_bot

# Environment
NODE_ENV=production
DEBUG=false
```

### 5. Start the Bot

```bash
npm start
```

## 📖 Bot Setup

1. Create a Discord Application at [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a Bot and copy the token
3. Add the token to your `.env` file
4. Invite the bot with these permissions:
   - **Manage Channels** (create/delete voice channels)
   - **Connect** (join voice channels)
   - **Move Members** (move users to new channels)
   - **View Channels** (see existing channels)
   - **Send Messages** (respond to commands)

## 🏴‍☠️ How It Works

### Voice Channel Creation
1. Join "🏴 Set Sail Together" channel
2. Bot creates a new pirate crew with a One Piece themed name
3. You become the captain with admin permissions
4. Channel inherits all category permissions + captain perms
5. Empty crews automatically disband after 5 seconds

### Voice Time Tracking
- Bot automatically tracks when you join/leave voice channels
- Data is stored in PostgreSQL with timestamps and duration
- Use `!voicestats` to view your activity statistics

### Category Management
- Bot remembers which category you use for voice channels
- If you move the category, bot will auto-sync to new location
- Category preferences are saved per-server in the database

## 🎮 Commands

| Command | Description |
|---------|-------------|
| `!voicestats` or `!stats` | View your voice activity stats (last 30 days) |
| `!ping` | Check bot latency and status |
| `!botinfo` | View bot information and uptime |
| `!help` | Show help message with all commands |

## 🗄️ Database Schema

### guild_settings
Stores category preferences per server:
```sql
guild_id VARCHAR(255) PRIMARY KEY
category_id VARCHAR(255) NOT NULL
category_name VARCHAR(255) NOT NULL
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

### voice_time_tracking
Tracks user voice activity:
```sql
id SERIAL PRIMARY KEY
user_id VARCHAR(255) NOT NULL
guild_id VARCHAR(255) NOT NULL
channel_id VARCHAR(255) NOT NULL
channel_name VARCHAR(255) NOT NULL
join_time TIMESTAMP NOT NULL
leave_time TIMESTAMP
duration_seconds INTEGER
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
```

## 🔧 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Your Discord bot token | Required |
| `CLIENT_ID` | Your Discord application client ID | Required |
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `CREATE_CHANNEL_NAME` | Name of channel that triggers creation | "🏴 Set Sail Together" |
| `CATEGORY_NAME` | Default category name | "🌊 Grand Line Voice Channels" |
| `DELETE_DELAY` | Delay before deleting empty channels (ms) | 5000 |
| `NODE_ENV` | Environment (production/development) | "production" |
| `DEBUG` | Enable debug logging | false |

## 🚢 Channel Names

The bot uses 30+ authentic One Piece themed names:
- 🐠 Fish-Man Island
- 🏝️ Skypiea Adventure
- 🌸 Sakura Kingdom
- 🏜️ Alabasta Palace
- 🌋 Punk Hazard Lab
- 🍭 Whole Cake Island
- 🌺 Wano Country
- And many more!

## 🛠️ Development

### Running in Development Mode
```bash
# Enable debug logging
echo "DEBUG=true" >> .env

# Start with nodemon for auto-restart
npm run dev
```

### Testing Database Connection
```bash
# Test PostgreSQL connection
psql $DATABASE_URL -c "SELECT NOW();"
```

### Monitoring Logs
The bot provides detailed logging:
- 🏴‍☠️ General bot activity
- 🔍 Debug information (when DEBUG=true)
- 📊 Voice session tracking
- 🗄️ Database operations
- ❌ Error messages

## 🐛 Troubleshooting

### Common Issues

**Bot doesn't respond to join channel:**
- Check CREATE_CHANNEL_NAME matches exactly
- Verify bot has "Manage Channels" permission
- Check DEBUG logs for error messages

**Database errors:**
- Verify DATABASE_URL is correct
- Check PostgreSQL is running
- Ensure database exists and bot has permissions

**Permissions not syncing:**
- Bot needs "Manage Channels" permission
- Category must exist before channel creation
- Check Discord audit logs for permission errors

**Voice tracking not working:**
- Check DATABASE_URL connection
- Verify voice_time_tracking table exists
- Monitor DEBUG logs for session tracking

## 📊 Analytics Queries

### Top Voice Users (Last 30 Days)
```sql
SELECT user_id, SUM(duration_seconds)/3600 as hours
FROM voice_time_tracking 
WHERE join_time >= NOW() - INTERVAL '30 days'
GROUP BY user_id 
ORDER BY hours DESC;
```

### Daily Voice Activity
```sql
SELECT DATE(join_time) as date, 
       COUNT(*) as sessions,
       SUM(duration_seconds)/3600 as total_hours
FROM voice_time_tracking 
GROUP BY DATE(join_time) 
ORDER BY date DESC;
```

## 🔒 Security

- Bot token is stored securely in environment variables
- Database credentials are not logged
- No user data is stored beyond voice session timing
- All database queries use parameterized statements

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

If you encounter any issues:
1. Check the troubleshooting section
2. Enable DEBUG=true for detailed logs
3. Check your database connection
4. Verify Discord permissions
5. Create an issue with logs and error details

---

⚓ **Set sail with your crew and explore the Grand Line!** 🏴‍☠️
