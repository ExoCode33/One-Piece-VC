const { PermissionFlagsBits } = require('discord.js');

module.exports = {
    CAPTAIN_PERMISSIONS: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.MoveMembers
    ],
    CREW_PERMISSIONS: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect
    ]
};
