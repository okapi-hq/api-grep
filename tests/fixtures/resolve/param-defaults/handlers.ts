import OpenAI from "openai";

const client = new OpenAI();

interface Handler {
  run(model: string): Promise<unknown>;
}

// a method of an object no type is given to: its callers give its values
const helpers = {
  ask(model: string) {
    return client.chat.completions.create({ model, messages: [] });
  },
};
export const asked = helpers.ask("o3");

// a method of an object of a type shares the type's member with every such object: its callers are not searched
export const handler: Handler = {
  run(model: string) {
    return client.chat.completions.create({ model, messages: [] });
  },
};
export const ran = handler.run("o1");
