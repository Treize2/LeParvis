from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import Suggestion
from ..schemas import SuggestionCreate

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.post("", status_code=201)
def submit_suggestion(payload: SuggestionCreate, db: Session = Depends(get_db)):
    suggestion = Suggestion(
        church_id=payload.church_id,
        payload=payload.payload,
        submitter_email=payload.submitter_email,
        notes=payload.notes,
    )
    db.add(suggestion)
    db.commit()
    db.refresh(suggestion)
    return {"id": suggestion.id, "status": suggestion.status}
