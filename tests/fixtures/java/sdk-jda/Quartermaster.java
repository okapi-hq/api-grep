package com.example.quartermaster;

import java.util.concurrent.TimeUnit;
import net.dv8tion.jda.api.EmbedBuilder;
import net.dv8tion.jda.api.JDA;
import net.dv8tion.jda.api.entities.Guild;
import net.dv8tion.jda.api.entities.channel.middleman.MessageChannel;
import net.dv8tion.jda.api.events.interaction.command.SlashCommandInteractionEvent;
import net.dv8tion.jda.api.events.interaction.component.ButtonInteractionEvent;
import net.dv8tion.jda.api.events.session.ReadyEvent;
import net.dv8tion.jda.api.hooks.ListenerAdapter;
import net.dv8tion.jda.api.interactions.commands.build.Commands;

public class Quartermaster extends ListenerAdapter {
    @Override
    public void onReady(ReadyEvent event) {
        event.getJDA().updateCommands().addCommands(Commands.slash("stock", "Shows the stock")).queue();
    }

    @Override
    public void onSlashCommandInteraction(SlashCommandInteractionEvent event) {
        event.deferReply(true).queue();
        event.getHook().sendMessage("counting crates").queue();
        event.getChannel().sendMessageEmbeds(new EmbedBuilder().setTitle("Stock").build()).queue();
        event.getGuild().ban(event.getUser(), 1, TimeUnit.DAYS).queue();
    }

    @Override
    public void onButtonInteraction(ButtonInteractionEvent event) {
        event.editMessage("restocked").queue();
    }

    public void syncGuild(JDA jda) {
        jda.getGuildById("1400000000000000003").updateCommands().queue();
        Guild guild = jda.getGuildById("1400000000000000003");
        guild.retrieveMemberById("1500000000000000004").complete();
    }

    public void sweep(MessageChannel channel) {
        channel.deleteMessageById("1600000000000000005").queue();
        channel.sendTyping().queue();
    }
}
