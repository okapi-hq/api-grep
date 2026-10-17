package opsbot

import (
	"os"

	"github.com/bwmarrin/discordgo"
)

func StartDiscord() (*discordgo.Session, error) {
	dg, err := discordgo.New("Bot " + os.Getenv("DISCORD_TOKEN"))
	if err != nil {
		return nil, err
	}
	dg.AddHandler(onMessage)
	return dg, dg.Open()
}

func onMessage(s *discordgo.Session, m *discordgo.MessageCreate) {
	if m.Content == "!status" {
		s.ChannelMessageSend(m.ChannelID, "all green")
	}
}

func Announce(s *discordgo.Session, channelID string, title string) error {
	_, err := s.ChannelMessageSendComplex(channelID, &discordgo.MessageSend{Content: title})
	return err
}

func Grant(s *discordgo.Session, guildID, userID string) error {
	return s.GuildMemberRoleAdd(guildID, userID, "1200000000000000001")
}
