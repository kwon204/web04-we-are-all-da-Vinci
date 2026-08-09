import { EntityData } from "@mikro-orm/core";
import { Factory } from "@mikro-orm/seeder";
import { Prompt } from "@server-toss/domain/modules/prompt/prompt.entity";

export class PromptFactory extends Factory<Prompt> {
  model = Prompt;
  definition(input?: EntityData<Prompt>): EntityData<Prompt> {
    return {
      ...input,
    };
  }
}
