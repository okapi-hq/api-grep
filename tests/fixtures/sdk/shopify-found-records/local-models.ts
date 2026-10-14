import { shopifyApi } from "@shopify/shopify-api";
import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm";

export const shopify = shopifyApi({ apiKey: "key", apiSecretKey: "secret", hostName: "app.example-kites.dev", isEmbeddedApp: false });

/** The app's own table, also named Product: a record it finds and saves is a database write, not a Shopify call. */
@Entity()
export class Product extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;

  static find(where: { id: number }) {
    return Product.findOneBy(where);
  }
}

export async function renameLocalKite(id: number, title: string) {
  const product = await Product.find({ id });
  if (!product) return;
  product.title = title;
  await product.save();
}

export async function renameStoredKite(id: number, title: string) {
  const product = await Product.findOneBy({ id });
  if (!product) return;
  product.title = title;
  await product.save();
}
