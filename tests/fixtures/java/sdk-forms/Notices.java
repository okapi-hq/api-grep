package com.example.notices;

import com.mailgun.api.v3.MailgunMessagesApi;
import com.mailgun.client.MailgunClient;
import com.mailgun.model.message.Message;
import com.sendgrid.Method;
import com.sendgrid.Request;
import com.sendgrid.SendGrid;

public class Notices {
    private final SendGrid sendgrid = new SendGrid(System.getenv("SENDGRID_API_KEY"));
    private final MailgunMessagesApi euMail = MailgunClient.config("https://api.eu.mailgun.net/", System.getenv("MAILGUN_API_KEY")).createApi(MailgunMessagesApi.class);
    private final MailgunMessagesApi usMail = MailgunClient.config(System.getenv("MAILGUN_API_KEY")).createApi(MailgunMessagesApi.class);

    public void bounces() throws Exception {
        Request request = new Request();
        request.setMethod(Method.GET);
        request.setEndpoint("suppression/bounces");
        sendgrid.api(request);
    }

    public void forget(String email) throws Exception {
        Request request = new Request();
        request.setMethod(Method.DELETE);
        request.setEndpoint("asm/suppressions/global/" + email);
        sendgrid.api(request);
    }

    // no method set: the method of `mail/send`
    public void send(String json) throws Exception {
        Request request = new Request();
        request.setEndpoint("mail/send");
        request.setBody(json);
        sendgrid.api(request);
    }

    public void relay(Method method, String endpoint) throws Exception {
        Request request = new Request();
        request.setMethod(method);
        request.setEndpoint(endpoint);
        sendgrid.api(request);
    }

    public void remind(String to) {
        euMail.sendMessage("notices.example.eu", Message.builder().from("notices@example.eu").to(to).subject("Reminder").text("Your invoice is due").build());
    }

    public void welcome(String to) {
        usMail.sendMessage("notices.example.com", Message.builder().from("hello@example.com").to(to).subject("Welcome").build());
    }
}
