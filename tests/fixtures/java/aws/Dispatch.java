package com.example.warehouse;

import java.io.File;
import com.amazonaws.regions.Regions;
import com.amazonaws.services.s3.AmazonS3;
import com.amazonaws.services.s3.AmazonS3ClientBuilder;
import com.amazonaws.services.s3.transfer.TransferManager;
import com.amazonaws.services.s3.transfer.TransferManagerBuilder;
import software.amazon.awssdk.services.sqs.SqsClient;
import software.amazon.awssdk.services.sqs.model.SendMessageRequest;

public class Dispatch {
    private static final String LABELS = "warehouse-labels";

    private final SqsClient sqs;
    private final AmazonS3 s3 = AmazonS3ClientBuilder.standard().withRegion(Regions.EU_CENTRAL_1).build();

    public Dispatch(SqsClient sqs) {
        this.sqs = sqs;
    }

    public void ship(String queueUrl, String order) {
        sqs.sendMessage(SendMessageRequest.builder().queueUrl(queueUrl).messageBody(order).delaySeconds(10).build());
    }

    public void poll(String queueUrl) {
        sqs.receiveMessage(r -> r.queueUrl(queueUrl).maxNumberOfMessages(10));
    }

    public void label(String order, File pdf) {
        s3.putObject(LABELS, order + ".pdf", pdf);
    }

    public String read(String order) {
        return s3.getObjectAsString(LABELS, order + ".pdf");
    }

    public void bulk(String order, File archive) {
        TransferManager tm = TransferManagerBuilder.standard().withS3Client(s3).build();
        tm.upload(LABELS, "bulk/" + order, archive);
    }

    // signs a URL locally: no request
    public String link(String order) {
        return s3.generatePresignedUrl(LABELS, order, new java.util.Date()).toString();
    }
}
