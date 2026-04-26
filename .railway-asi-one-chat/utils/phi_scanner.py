from presidio_analyzer import AnalyzerEngine
from presidio_analyzer.nlp_engine import NlpEngineProvider
from presidio_anonymizer import AnonymizerEngine

_nlp_engine = NlpEngineProvider(nlp_configuration={
    "nlp_engine_name": "spacy",
    "models": [{"lang_code": "en", "model_name": "en_core_web_sm"}],
}).create_engine()
_analyzer = AnalyzerEngine(nlp_engine=_nlp_engine, supported_languages=["en"])
_anonymizer = AnonymizerEngine()

_ENTITIES = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "DATE_TIME",
    "LOCATION",
    "US_SSN",
    "MEDICAL_LICENSE",
]


def scan_and_redact(text: str) -> tuple[str, list[str]]:
    results = _analyzer.analyze(text=text, entities=_ENTITIES, language="en")
    if not results:
        return text, []
    entity_types = list({r.entity_type for r in results})
    anonymized = _anonymizer.anonymize(text=text, analyzer_results=results)
    return anonymized.text, entity_types
