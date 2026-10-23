from vertexai.preview.generative_models import GenerativeModel


def draft(prompt):
    return GenerativeModel("gemini-1.5-pro").generate_content(prompt)
