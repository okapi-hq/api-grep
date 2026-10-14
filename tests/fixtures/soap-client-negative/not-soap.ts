import { createClient } from "queue-lib";

// a callback's second parameter, from another library's createClient: not a SOAP client
export function enqueue(job: string) {
  createClient("https://queue.example-jobs.com/?wsdl", (err: unknown, client: { Track(a: unknown): void }) => {
    client.Track({ Job: job });
  });
}
