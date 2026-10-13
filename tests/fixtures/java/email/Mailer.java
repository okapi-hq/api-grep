package com.example.mailer;

import com.mailgun.api.v3.MailgunMessagesApi;
import com.mailgun.client.MailgunClient;
import com.mailgun.model.message.Message;
import com.resend.Resend;
import com.resend.services.emails.model.CreateEmailOptions;
import com.sendgrid.Method;
import com.sendgrid.Request;
import com.sendgrid.SendGrid;
import com.sendgrid.helpers.mail.Mail;

public class Mailer {
    private static final String DOMAIN = "mail.example.com";

    private final SendGrid sendgrid = new SendGrid(System.getenv("SENDGRID_API_KEY"));
    private final Resend resend = new Resend(System.getenv("RESEND_API_KEY"));
    private final MailgunMessagesApi mailgun = MailgunClient.config(System.getenv("MAILGUN_API_KEY")).createApi(MailgunMessagesApi.class);

    public void welcome(Mail mail) throws Exception {
        Request request = new Request();
        request.setMethod(Method.POST);
        request.setEndpoint("mail/send");
        request.setBody(mail.build());
        sendgrid.api(request);
    }

    public void receipt(String to, String html) {
        resend.emails().send(CreateEmailOptions.builder().from("billing@example.com").to(to).subject("Your receipt").html(html).replyTo("support@example.com").build());
    }

    public void digest(String to, String text) {
        mailgun.sendMessage(DOMAIN, Message.builder().from("digest@example.com").to(to).subject("Weekly digest").text(text).build());
    }
}
