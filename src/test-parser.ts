
import SwaggerParser from "@apidevtools/swagger-parser";

async function test() {
    try {
        const spec = {
            openapi: "3.0.0",
            info: { title: "Test", version: "1.0" },
            paths: {
                "/test": {
                    get: {
                        responses: {
                            "200": {
                                description: "ok",
                                content: {
                                    "application/json": {
                                        schema: {
                                            $ref: "#/components/schemas/Test"
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            },
            components: {
                schemas: {
                    Test: {
                        type: "object",
                        properties: {
                            foo: { type: "string" }
                        }
                    }
                }
            }
        };

        const parsed = await SwaggerParser.dereference(spec as any);
        console.log("Dereferenced:", JSON.stringify(parsed, null, 2));
    } catch (e) {
        console.error(e);
    }
}

test();
