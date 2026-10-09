export function sobject(instance: string, id: string) {
  return fetch(`https://${instance}.my.salesforce.com/services/data/v60.0/sobjects/Account/${id}`);
}

export function bucketObject(bucket: string, key: string) {
  return fetch(`https://${bucket}.s3.amazonaws.com/${key}`);
}

// no provider lists this domain: a customer's subdomain names the vendor's domain
export function tickets(subdomain: string) {
  return fetch(`https://${subdomain}.example-helpdesk.com/api/v2/tickets.json`);
}
