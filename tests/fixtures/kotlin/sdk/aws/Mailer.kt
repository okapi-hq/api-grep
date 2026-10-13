package com.example.shop

import java.nio.file.Path
import software.amazon.awssdk.regions.Region
import software.amazon.awssdk.services.s3.presigner.S3Presigner
import software.amazon.awssdk.services.ses.SesClient
import software.amazon.awssdk.services.sesv2.SesV2Client
import software.amazon.awssdk.services.sns.SnsClient
import software.amazon.awssdk.services.sns.model.PublishRequest
import software.amazon.awssdk.transfer.s3.S3TransferManager
import software.amazon.awssdk.transfer.s3.model.UploadFileRequest

class Mailer(private val sns: SnsClient) {
    private val ses = SesClient.create()
    private val mail = SesV2Client.builder().region(Region.EU_WEST_3).build()
    private val transfers = S3TransferManager.create()
    private val presigner = S3Presigner.create()

    fun alert(topic: String, text: String) = sns.publish(PublishRequest.builder().topicArn(topic).message(text).build())

    fun welcome(to: String) = ses.sendEmail { it.source("hello@example.com").destination { d -> d.toAddresses(to) } }

    fun receipt(to: String) = mail.sendEmail { it.fromEmailAddress("billing@example.com").destination { d -> d.toAddresses(to) } }

    fun identity(id: String) = mail.getEmailIdentity { it.emailIdentity(id) }

    fun upload(key: String, file: Path) =
        transfers.uploadFile(UploadFileRequest.builder().putObjectRequest { b -> b.bucket("shop-media").key(key) }.source(file).build())

    // signs a URL locally: no request
    fun link(key: String) = presigner.presignGetObject { it.signatureDuration(java.time.Duration.ofMinutes(5)) }
}
