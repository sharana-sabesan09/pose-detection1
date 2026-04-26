import logging
import chromadb
from llama_index.core import VectorStoreIndex, Document, Settings
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.core.storage.storage_context import StorageContext
from llama_index.embeddings.huggingface import HuggingFaceEmbedding
from config import settings

logger = logging.getLogger(__name__)

COLLECTION_NAME = "clinical_guidelines"

_PLACEHOLDER_DOCS = [
    Document(
        text="""CDC STEADI Fall Prevention Toolkit — Key Recommendations

Screening: Ask older adults about falls, unsteadiness, and fear of falling.
Assessment: Conduct a fall risk assessment using validated tools (TUG, 30-Second Chair Stand, 4-Stage Balance Test).
Intervention: For patients at increased risk, refer to evidence-based fall prevention programs.

Risk factors:
- Lower extremity weakness (Odds Ratio 4.4)
- History of falls (OR 3.0)
- Balance and gait deficits (OR 2.9)
- Visual impairment (OR 2.5)
- Polypharmacy (≥4 medications) (OR 1.5)

The Timed Up and Go (TUG) test: ≥12 seconds indicates increased fall risk.
30-Second Chair Stand: <8 stands for women 60-64, <7 stands for men 60-64 indicates weakness.

Interventions shown to reduce falls:
- Exercise programs (balance, strength, gait training)
- Medication review and modification
- Vision correction
- Home hazard modification
- Vitamin D supplementation for deficient patients
""",
        metadata={"source": "CDC STEADI", "type": "fall_prevention"},
    ),
    Document(
        text="""Berg Balance Scale — Clinical Scoring Guide

The Berg Balance Scale (BBS) is a 14-item validated assessment of static and dynamic balance.
Each item scored 0 (unable) to 4 (independent), total 0–56.

Score interpretation:
- 41–56: Low fall risk
- 21–40: Medium fall risk; walking aid recommended
- 0–20: High fall risk; wheelchair use may be necessary

Key items assessed:
1. Sitting to standing
2. Standing unsupported
3. Sitting unsupported
4. Standing to sitting
5. Transfers
6. Standing with eyes closed
7. Standing with feet together
8. Reaching forward with outstretched arm
9. Retrieving object from floor
10. Turning to look behind
11. Turning 360 degrees
12. Placing alternate foot on stool
13. Standing with one foot in front
14. Standing on one foot

Minimal Detectable Change (MDC): 4 points.
Clinically important difference: 4-5 points for community-dwelling older adults.
""",
        metadata={"source": "Berg Balance Scale", "type": "assessment"},
    ),
    Document(
        text="""Range of Motion and Reinjury Risk — Physical Therapy Guidelines

Normal joint ROM (degrees):
- Hip flexion: 0–120; extension: 0–30; abduction: 0–45; internal rotation: 0–45; external rotation: 0–45
- Knee flexion: 0–135; extension: 0 (full extension)
- Ankle dorsiflexion: 0–20; plantarflexion: 0–50
- Shoulder flexion: 0–180; abduction: 0–180; external rotation: 0–90; internal rotation: 0–70
- Lumbar flexion: 0–60; extension: 0–25; lateral flexion: 0–25

Reinjury risk indicators:
- ROM <60% of normal for affected joint → high reinjury risk
- ROM 60–80% of normal → moderate risk
- ROM >80% of normal → low risk

Trend-based risk assessment:
- ROM declining over consecutive sessions → worsening prognosis
- ROM improving consistently → positive indicator
- Pain scores increasing alongside ROM loss → urgent clinical concern

Muscle imbalance thresholds:
- Hamstring:Quadriceps ratio <0.6 → elevated ACL reinjury risk
- Bilateral strength difference >15% → elevated risk for lower extremity
""",
        metadata={"source": "PT Reinjury Risk Guidelines", "type": "reinjury_risk"},
    ),
]


def load_clinical_guidelines():
    client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)

    try:
        collection = client.get_collection(COLLECTION_NAME)
        if collection.count() > 0:
            logger.info("Clinical guidelines already loaded (%d chunks)", collection.count())
            return
    except Exception:
        pass

    logger.info("Loading clinical guidelines into ChromaDB...")

    embed_model = HuggingFaceEmbedding(model_name="sentence-transformers/all-MiniLM-L6-v2")
    Settings.embed_model = embed_model
    Settings.chunk_size = 512
    Settings.chunk_overlap = 64

    chroma_collection = client.get_or_create_collection(COLLECTION_NAME)
    vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
    storage_context = StorageContext.from_defaults(vector_store=vector_store)

    VectorStoreIndex.from_documents(
        _PLACEHOLDER_DOCS,
        storage_context=storage_context,
    )
    logger.info("Clinical guidelines loaded successfully")
