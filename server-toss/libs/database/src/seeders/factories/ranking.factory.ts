import { EntityData } from "@mikro-orm/core";
import { Factory } from "@mikro-orm/seeder";
import { Ranking } from "@server-toss/domain/modules/ranking/ranking.entity";

export class RankingFactory extends Factory<Ranking> {
  model = Ranking;
  protected definition(input: EntityData<Ranking>): EntityData<Ranking> {
    return { ...input };
  }
}
