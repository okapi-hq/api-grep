package com.example.links;

import io.grpc.CallOptions;
import io.grpc.ManagedChannel;
import io.grpc.MethodDescriptor;
import java.util.HashMap;
import java.util.Map;
import javax.ws.rs.GET;
import javax.ws.rs.POST;
import javax.ws.rs.Path;
import javax.ws.rs.PathParam;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// endpoints this service serves, not requests it sends
@RestController
@RequestMapping("/api")
class LinksController {
    @GetMapping("/links/{id}")
    String get(String id) {
        return id;
    }

    @PostMapping("/links")
    String create(@RequestBody String url) {
        return url;
    }
}

// a JAX-RS resource shares Retrofit's annotation names
@Path("/notes")
interface NotesResource {
    @GET
    @Path("/{id}")
    String get(@PathParam("id") String id);

    @POST
    String create(String body);
}

// a gRPC call is not an OkHttp call, even with a descriptor built by `newBuilder()`
class Lookup {
    private final ManagedChannel channel;
    private final MethodDescriptor<String, String> method = MethodDescriptor.<String, String>newBuilder()
        .setType(MethodDescriptor.MethodType.UNARY)
        .setFullMethodName("links.Lookup/Get")
        .build();

    Lookup(ManagedChannel channel) {
        this.channel = channel;
    }

    Object call() {
        return channel.newCall(method, CallOptions.DEFAULT);
    }
}

class Settings {
    private final Map<String, String> defaults = new HashMap<>();

    String send(String key) {
        return defaults.put(key, "x");
    }

    String read(String key) throws Exception {
        // a resource bundled with the app
        return new String(getClass().getResource("/defaults.json").openConnection().getInputStream().readAllBytes());
    }
}
