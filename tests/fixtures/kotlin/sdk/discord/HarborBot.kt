package com.example.harbor

import net.dv8tion.jda.api.JDA
import net.dv8tion.jda.api.JDABuilder
import net.dv8tion.jda.api.entities.Guild
import net.dv8tion.jda.api.entities.Member
import net.dv8tion.jda.api.entities.Message
import net.dv8tion.jda.api.entities.channel.concrete.TextChannel
import net.dv8tion.jda.api.entities.emoji.Emoji
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent
import net.dv8tion.jda.api.events.message.MessageReceivedEvent
import net.dv8tion.jda.api.hooks.ListenerAdapter
import net.dv8tion.jda.api.interactions.commands.build.Commands
import net.dv8tion.jda.api.requests.GatewayIntent

class HarborListener : ListenerAdapter() {
    override fun onMessageReceived(event: MessageReceivedEvent) {
        if (event.author.isBot) return
        event.channel.sendMessage("ahoy").queue()
        event.message.reply("noted").queue()
        event.message.addReaction(Emoji.fromUnicode("U+2693")).queue()
        event.message.delete().queue()
    }

    override fun onSlashCommandInteraction(event: SlashCommandInteractionEvent) {
        when (event.name) {
            "ping" -> event.reply("pong").setEphemeral(true).queue()
            "tide" -> {
                event.deferReply().queue()
                event.hook.editOriginal("high tide at noon").queue()
            }
        }
    }
}

class HarborOps(private val jda: JDA) {
    fun announce(text: String) {
        jda.getTextChannelById("1200000000000000001")?.sendMessage(text)?.queue()
    }

    fun registerCommands() {
        jda.updateCommands().addCommands(Commands.slash("ping", "Replies with pong")).queue()
    }

    fun promote(guild: Guild, member: Member) {
        val role = guild.getRoleById("1300000000000000002") ?: return
        guild.addRoleToMember(member, role).queue()
    }

    fun eject(member: Member) {
        member.kick().complete()
    }

    fun edit(channel: TextChannel, message: Message) {
        channel.editMessageById(message.id, "updated").submit()
        message.editMessage("edited").queue()
    }
}

fun main() {
    val jda = JDABuilder.createDefault(System.getenv("DISCORD_TOKEN"))
        .enableIntents(GatewayIntent.MESSAGE_CONTENT)
        .addEventListeners(HarborListener())
        .build()
    jda.awaitReady()
    HarborOps(jda).announce("harbor open")
}
