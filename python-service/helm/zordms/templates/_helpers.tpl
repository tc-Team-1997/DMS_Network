{{- define "zordms.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "zordms.fullname" -}}
{{- printf "%s-%s" .Release.Name (include "zordms.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "zordms.labels" -}}
app.kubernetes.io/name: {{ include "zordms.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}
