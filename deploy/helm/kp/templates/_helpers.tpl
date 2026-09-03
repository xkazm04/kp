{{- define "kp.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "kp.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "kp.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "kp.labels" -}}
helm.sh/chart: {{ include "kp.chart" . }}
{{ include "kp.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "kp.selectorLabels" -}}
app.kubernetes.io/name: {{ include "kp.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* The Secret holding KP_OPERATOR_PASSWORD/KP_SECRET (+ provider keys): the
     existing one if given, else the chart-managed one. */}}
{{- define "kp.secretName" -}}
{{- if .Values.existingSecret -}}{{ .Values.existingSecret }}{{- else -}}{{ include "kp.fullname" . }}{{- end -}}
{{- end -}}

{{/* The ServiceAccount the pod runs as: the chart-managed one unless the operator
     named their own. Falls back to `default` only when they turned creation off
     without naming a replacement — the pod-level automountServiceAccountToken:
     false in deployment.yaml is what keeps that case tokenless too. */}}
{{- define "kp.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "kp.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* PVC name for /data. */}}
{{- define "kp.pvcName" -}}
{{- if .Values.persistence.existingClaim -}}{{ .Values.persistence.existingClaim }}{{- else -}}{{ include "kp.fullname" . }}-data{{- end -}}
{{- end -}}
