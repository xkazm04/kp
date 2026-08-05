"""Provider adapters. Each implements the TextProvider surface; SDKs are
imported lazily inside calls so an environment missing one provider's SDK can
still use the others (available() reports the gap instead of crashing)."""

from .anthropic_api import AnthropicProvider
from .azure_openai import AzureOpenAIProvider
from .gemini_api import GeminiProvider
from .ollama import OllamaProvider
from .openai_api import OpenAIProvider
from .openrouter import OpenRouterProvider
from .qwen import QwenProvider

ADAPTERS = {
    "anthropic": AnthropicProvider,
    "openai": OpenAIProvider,
    "azure_openai": AzureOpenAIProvider,
    "gemini": GeminiProvider,
    "openrouter": OpenRouterProvider,
    "ollama": OllamaProvider,
    "qwen": QwenProvider,
}

__all__ = [
    "ADAPTERS",
    "AnthropicProvider",
    "AzureOpenAIProvider",
    "GeminiProvider",
    "OllamaProvider",
    "OpenAIProvider",
    "OpenRouterProvider",
    "QwenProvider",
]
