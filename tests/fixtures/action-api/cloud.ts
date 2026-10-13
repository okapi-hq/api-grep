import axios from "axios";

// AWS Query API: the operation is the Action parameter
export function instances() {
  return fetch("https://ec2.amazonaws.com/?Action=DescribeInstances&Version=2016-11-15");
}

// the same API with a form body
export function enqueue(queueUrl: string, message: string) {
  return fetch("https://sqs.us-east-1.amazonaws.com/123456789012/jobs", {
    method: "POST",
    body: new URLSearchParams({ Action: "SendMessage", MessageBody: message, Version: "2012-11-05" }),
  });
}

// a branch picks the action
export function subscription(on: boolean, topic: string) {
  const action = on ? "Subscribe" : "Unsubscribe";
  return axios.get("https://sns.us-east-1.amazonaws.com/", { params: { Action: action, TopicArn: topic } });
}

// Flickr names the method in the query
export function photos(tag: string) {
  return axios.get("https://api.flickr.com/services/rest/", { params: { method: "flickr.photos.search", tags: tag, format: "json" } });
}

// a provider that declares no operation parameter keeps its calls as they are
export function search(q: string) {
  return fetch(`https://api.example-search.com/v1/find?Action=lookup&q=${q}`);
}

// an AWS REST API (S3) has no Action
export function object(key: string) {
  return fetch(`https://example-bucket.s3.amazonaws.com/${key}`);
}
