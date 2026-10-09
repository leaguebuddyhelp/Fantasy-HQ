const privateAcknowledgments = new WeakSet();
const EXPIRED_INTERACTION_CODES = new Set([10062, 40060]);

async function replyInteractionError(interaction, error, logger = console, preferFollowUp = false) {
    logger.error("Discord interaction failed:", { code: error.code, message: error.message, command: interaction.commandName, customId: interaction.customId, guildId: interaction.guildId });
    if (EXPIRED_INTERACTION_CODES.has(Number(error.code))) return;
    const content = `Error: ${error.message}`;
    try {
        const flags = require("discord.js").MessageFlags.Ephemeral;
        const privateReply = interaction.ephemeral === true || privateAcknowledgments.has(interaction);
        if (interaction.deferred || interaction.replied) {
            if (privateReply && !preferFollowUp) await interaction.editReply(content);
            else {
                // A deferred public response cannot be made ephemeral after acknowledgment.
                if (interaction.deferred && !interaction.replied && !preferFollowUp) {
                    await interaction.editReply({ content: 'This request could not be completed. See your private error message.', embeds: [], components: [], attachments: [] });
                }
                await interaction.followUp({ content, flags, allowedMentions: { parse: [] } });
            }
        } else await interaction.reply({ content, flags, allowedMentions: { parse: [] } });
    } catch (responseError) {
        if (!EXPIRED_INTERACTION_CODES.has(Number(responseError.code))) logger.error("Could not send interaction error response:", { code: responseError.code, message: responseError.message });
    }
}

// Acknowledge before network role reconciliation. Decorate the individual interaction,
// preserving each route's chosen response (including modal and message-update flows).
function updatesSourceMessage(interaction) {
    if (!(interaction.isButton?.() || interaction.isStringSelectMenu?.())) return false;
    const [root, action] = String(interaction.customId || '').split(':');
    if (root === 'trade') return true;
    if (root === 'fa') return !['sign', 'active', 'waive', 'approve', 'reject', 'correct', 'waiverapprove', 'waiverreject', 'player', 'improve', 'edit'].includes(action);
    if (root === 'upgrades') return ['source', 'players', 'player', 'category', 'special', 'attribute', 'points', 'add', 'remove', 'review', 'categories', 'back', 'submit', 'reject', 'buildpage', 'buildselect'].includes(action);
    return false;
}

async function runDiscordInteraction(interaction, handler, { refreshActor = async () => {}, logger = console } = {}) {
    const methods = new Map();
    let reconciled = false, initialUpdate = false;
    for (const name of ['deferReply', 'deferUpdate', 'reply', 'update', 'showModal']) {
        if (typeof interaction[name] !== 'function') continue;
        const own = Object.getOwnPropertyDescriptor(interaction, name), original = interaction[name];
        methods.set(name, { own, original });
        interaction[name] = async function (...args) {
            if (initialUpdate && name === 'deferUpdate') return;
            if (initialUpdate && name === 'update') return this.editReply(...args);
            if (initialUpdate && name === 'reply') return this.followUp(...args);
            const result = await original.apply(this, args);
            if (['deferReply', 'reply'].includes(name) && (Number(args[0]?.flags || 0) & 64)) privateAcknowledgments.add(interaction);
            if (['deferUpdate', 'update'].includes(name) && require('./discord-privacy').isEphemeralMessage(interaction.message)) privateAcknowledgments.add(interaction);
            if (!reconciled && interaction.guild && !interaction.isAutocomplete?.()) {
                reconciled = true;
                try { await refreshActor(interaction.guild, interaction.member); }
                catch (error) { throw Error('Could not verify your current team roles. ' + error.message); }
            }
            return result;
        };
    }
    try {
        // Builders that mutate before update() need role reconciliation before any
        // handler work. Defer the source update while preserving private replies.
        if (updatesSourceMessage(interaction) && typeof interaction.deferUpdate === 'function') {
            initialUpdate = true;
            await methods.get("deferUpdate").original.call(interaction);
            if(interaction.guild){reconciled=true;await refreshActor(interaction.guild, interaction.member);}
        }
        await handler(interaction);
    }
    catch (error) { await replyInteractionError(interaction, error, logger, initialUpdate); }
    finally {
        for (const [name, { own }] of methods) {
            if (own) Object.defineProperty(interaction, name, own);
            else delete interaction[name];
        }
    }
}

function logDiscordClientError(error, logger = console) {
    // Discord REST errors can contain interaction tokens in URLs; log only diagnostics.
    logger.error('Discord client error:', { code: error.code, message: error.message });
}
module.exports = { replyInteractionError, runDiscordInteraction, logDiscordClientError, updatesSourceMessage };
