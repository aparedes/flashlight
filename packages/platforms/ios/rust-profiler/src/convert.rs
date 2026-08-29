//! plist -> JSON conversion for command output (apps, info, devices).

use plist::Value;

pub fn plist_to_json(value: &Value) -> serde_json::Value {
    match value {
        Value::Dictionary(dict) => serde_json::Value::Object(
            dict.iter()
                .map(|(k, v)| (k.clone(), plist_to_json(v)))
                .collect(),
        ),
        Value::Array(arr) => serde_json::Value::Array(arr.iter().map(plist_to_json).collect()),
        Value::String(s) => serde_json::Value::String(s.clone()),
        Value::Boolean(b) => serde_json::Value::Bool(*b),
        Value::Integer(i) => i
            .as_signed()
            .map(serde_json::Value::from)
            .or_else(|| i.as_unsigned().map(serde_json::Value::from))
            .unwrap_or(serde_json::Value::Null),
        Value::Real(f) => serde_json::Number::from_f64(*f)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null),
        Value::Date(d) => serde_json::Value::String(format!("{d:?}")),
        Value::Data(_) => serde_json::Value::String("<binary>".to_string()),
        Value::Uid(_) => serde_json::Value::Null,
        _ => serde_json::Value::Null,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use plist::Dictionary;

    #[test]
    fn converts_nested_structures() {
        let mut inner = Dictionary::new();
        inner.insert("n".into(), Value::Integer(3.into()));
        let mut dict = Dictionary::new();
        dict.insert("s".into(), Value::String("x".into()));
        dict.insert("b".into(), Value::Boolean(true));
        dict.insert("r".into(), Value::Real(1.5));
        dict.insert(
            "a".into(),
            Value::Array(vec![Value::Dictionary(inner), Value::Data(vec![1, 2])]),
        );

        let json = plist_to_json(&Value::Dictionary(dict));
        assert_eq!(
            json,
            serde_json::json!({
                "s": "x",
                "b": true,
                "r": 1.5,
                "a": [{ "n": 3 }, "<binary>"],
            })
        );
    }
}
