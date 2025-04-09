# config.py

# Store your Mistral API key here
#MISTRAL_API_KEY = "AWZohrqdjPMK3xVSn6gYXMBG8Z3IwwYf"
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Settings:
    # API Keys
    MISTRAL_API_KEY = "AWZohrqdjPMK3xVSn6gYXMBG8Z3IwwYf"
    
    # Wikipedia settings
    WIKI_CONTENT_MAX_LENGTH = 4000  # Maximum characters to extract from each Wikipedia page
    MAX_WIKI_RESULTS = 10  # Maximum number of Wikipedia pages to search
    
    # Mistral settings
    MISTRAL_MODEL = "mistral-large-latest"  # Model ID to use
    MISTRAL_MAX_TOKENS = 1000  # Maximum tokens in response
    MISTRAL_TEMPERATURE = 0.7  # Temperature for response generation

settings = Settings()