import { shopifyApi } from "@shopify/shopify-api";
import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from "typeorm";

export const shopify = shopifyApi({ apiKey: "key", apiSecretKey: "secret", hostName: "app.example-kites.dev", isEmbeddedApp: false });

/** The app's own table, also named Product: saving it is a database write, not a Shopify call. */
@Entity()
export class Product extends BaseEntity {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  title!: string;
}

export async function rememberKite(title: string) {
  const product = new Product();
  product.title = title;
  await product.save();
  return product;
}

export async function forgetKite(id: number) {
  const product = new Product();
  product.id = id;
  await product.remove();
}
