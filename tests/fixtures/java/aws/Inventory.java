package com.example.warehouse;

import java.util.Map;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbEnhancedClient;
import software.amazon.awssdk.enhanced.dynamodb.DynamoDbTable;
import software.amazon.awssdk.enhanced.dynamodb.Key;
import software.amazon.awssdk.enhanced.dynamodb.TableSchema;
import software.amazon.awssdk.regions.Region;
import software.amazon.awssdk.services.dynamodb.DynamoDbClient;
import software.amazon.awssdk.services.dynamodb.model.AttributeValue;
import software.amazon.awssdk.services.dynamodb.model.PutItemRequest;

public class Inventory {
    private static final String TABLE = "warehouse-stock";

    private final DynamoDbClient ddb = DynamoDbClient.builder().region(Region.EU_CENTRAL_1).build();
    private final DynamoDbTable<StockItem> stock;

    public Inventory() {
        DynamoDbEnhancedClient enhanced = DynamoDbEnhancedClient.builder().dynamoDbClient(ddb).build();
        this.stock = enhanced.table(TABLE, TableSchema.fromBean(StockItem.class));
    }

    public void record(String sku, int count) {
        ddb.putItem(PutItemRequest.builder()
            .tableName(TABLE)
            .item(Map.of("sku", AttributeValue.builder().s(sku).build(), "count", AttributeValue.builder().n(String.valueOf(count)).build()))
            .build());
    }

    public void lookup(String sku) {
        ddb.query(r -> r.tableName(TABLE).keyConditionExpression("sku = :sku"));
    }

    public void save(StockItem item) {
        stock.putItem(item);
    }

    public StockItem find(String sku) {
        return stock.getItem(Key.builder().partitionValue(sku).build());
    }

    public void tables() {
        ddb.listTables();
    }
}
