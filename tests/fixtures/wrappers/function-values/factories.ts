// a factory returns the sender: its parameter is what the factory's call passes
function makeSender(base: string) {
  return (path: string, body: unknown) => fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });
}

const send = makeSender("https://hooks.parcelpost-demo.io");

export const notify = (id: string) => send(`/v2/parcels/${id}/notify`, { id });

// a method of an object literal, written as an arrow whose body is the request
const meter = {
  record: (name: string) => fetch(`https://api.meterly-demo.io/v1/events/${name}`, { method: "PUT" }),
};

export const track = () => meter.record("signup");

// the global fetch kept in a constant
const nativeFetch = globalThis.fetch;

export const ping = () => nativeFetch("https://ping.meterly-demo.io/v1/ping");

// the returned function calls a wrapper with the factory's parameters
async function releaseLease(base: string, id: string) {
  return fetch(`${base}/v1/leases/${id}`, { method: "DELETE" });
}

function createReleaser(base: string, id: string) {
  let done = false;
  return async () => {
    if (done) return;
    done = true;
    await releaseLease(base, id);
  };
}

export async function handle(id: string) {
  const release = createReleaser("https://leases.lockbox-demo.io", id);
  await release();
}
