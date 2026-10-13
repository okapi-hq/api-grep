package com.example.orders;

import feign.Feign;
import feign.Headers;
import feign.Param;
import feign.RequestLine;
import java.util.List;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.cloud.openfeign.SpringQueryMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;

class Order {
    private String sku;
    private int quantity;
}

record Filter(String status, Integer page) {}

@FeignClient(name = "orders", url = "${orders.url:https://api.example-orders.com}", path = "/v2")
interface OrdersClient {
    @GetMapping("/orders/{id}")
    Order get(@PathVariable("id") String id);

    @PostMapping("/orders")
    Order create(@RequestBody Order order, @RequestParam("dryRun") boolean dryRun, @RequestHeader("Idempotency-Key") String key);

    @RequestMapping(method = RequestMethod.DELETE, value = "/orders/{id}")
    void cancel(@PathVariable String id);

    @GetMapping("/orders")
    List<Order> search(@SpringQueryMap Filter filter);
}

@Headers("Accept: application/json")
interface Repos {
    @RequestLine("GET /repos/{owner}/{repo}/issues?state={state}")
    String issues(@Param("owner") String owner, @Param("repo") String repo, @Param("state") String state);

    @RequestLine("POST /repos/{owner}/{repo}/issues")
    @Headers("Content-Type: application/json")
    String open(@Param("owner") String owner, @Param("repo") String repo, String body);
}

class Github {
    static final Repos REPOS = Feign.builder().target(Repos.class, "https://api.github.com");
}
