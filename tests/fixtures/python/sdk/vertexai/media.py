from vertexai.language_models import TextEmbeddingModel
from vertexai.preview.vision_models import ImageGenerationModel

embedder = TextEmbeddingModel.from_pretrained("text-embedding-005")


def embed(texts):
    return embedder.get_embeddings(texts)


def cover(prompt):
    return ImageGenerationModel.from_pretrained("imagen-3.0-generate-002").generate_images(prompt=prompt, number_of_images=1)
