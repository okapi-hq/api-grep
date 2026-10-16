import { z } from "zod";

/** The model a call names: the names it can send and where each comes from. */

export const MODEL_SOURCES = ["default", "env_example", "config_file"] as const;

export const ModelSourceSchema = z
  .object({
    value: z.string().describe("One of `values`."),
    from: z
      .enum(MODEL_SOURCES)
      .describe(
        "default: a fallback the code gives (an env var's or a parameter's default, `x or \"gpt-4o\"`, a settings field's default); env_example: the value an example env file documents for the env var the code reads; config_file: a key of a config file the code loads by a literal path.",
      ),
    file: z.string().optional().describe("The example env file or config file, relative to the scanned directory, `/` separated."),
    key: z.string().optional().describe("config_file: the value's key path in the file (`llm.model`)."),
  })
  .meta({ id: "ModelSource", description: "Where a model name the code does not write as a literal comes from." });

export const ModelSchema = z
  .object({
    values: z
      .array(z.string())
      .describe(
        "Model names the call can send: those the code gives, literally or as a default (an environment variable's, a parameter's, a function's returns, every branch of a condition), those of a config file it loads and the one an example env file documents for `env`; `sources` says where each that is no literal comes from.",
      ),
    env: z.string().optional().describe("Environment variable the model is read from; `values` holds its default in the code, if any."),
    envExample: z
      .string()
      .optional()
      .describe("The value the repository's example env file nearest the call (`.env.example`, `.env.sample`, …) gives `env`; also in `values`, with the source `env_example`."),
    dynamic: z.boolean().describe("Some value could not be read statically (a parameter, a call result): `values` may be incomplete."),
    hint: z.string().optional().describe("Identifier the unread value comes from (`get_model`, `settings.model`)."),
    sources: z
      .array(ModelSourceSchema)
      .optional()
      .describe("Where the values of `values` that the code does not write as a literal come from; a value not listed is a literal the code gives."),
    from: z
      .enum(["body", "path", "argument"])
      .describe("Where the request carries it: a body property (`model`, `modelId`), a path segment (`/models/{model}`), or an SDK argument that is not the body (`openai(\"gpt-4o\")`)."),
  })
  .meta({ id: "Model", description: "The model a call names, as far as the code tells statically." });
