from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine

_analyzer = AnalyzerEngine()
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
