from uagents import Bureau
from agents.agentverse_agent import physio_agent
from agents.intake import intake_agent
from agents.pose_analysis import pose_agent
from agents.fall_risk import fall_risk_agent
from agents.reinjury_risk import reinjury_agent
from agents.reporter import reporter_agent
from agents.progress import progress_agent
from agents.patient_advisor import patient_advisor_agent

bureau = Bureau()
bureau.add(physio_agent)
bureau.add(intake_agent)
bureau.add(pose_agent)
bureau.add(fall_risk_agent)
bureau.add(reinjury_agent)
bureau.add(reporter_agent)
bureau.add(progress_agent)
bureau.add(patient_advisor_agent)
